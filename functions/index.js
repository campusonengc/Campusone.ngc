const {
  onDocumentCreated,
  onDocumentUpdated
} = require("firebase-functions/v2/firestore");

const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

const {
  initializeApp
} = require("firebase-admin/app");

const {
  getMessaging
} = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

async function getRecipients(job) {

  const usersSnap = await db.collection("users").get();

  const users = usersSnap.docs.map((doc) => ({
    uid: doc.id,
    ...doc.data()
  }));

  let recipients = users;

  if (job.recipientType === "students") {
    recipients = users.filter(
      (user) => user.role === "student"
    );
  }

  if (job.recipientType === "moderators") {
    recipients = users.filter(
      (user) => user.role === "moderator"
    );
  }

  if (job.recipientType === "admins") {
    recipients = users.filter(
      (user) => user.role === "admin"
    );
  }

  if (job.recipientType === "user") {
    recipients = users.filter(
      (user) => user.uid === job.userId
    );
  }

  if (job.academicYear) {
    recipients = recipients.filter(
      (user) =>
        user.academicYear === job.academicYear
    );
  }

  if (job.group) {
    recipients = recipients.filter(
      (user) =>
        user.group === job.group
    );
  }

  return recipients;
}

async function processNotificationJob(jobId) {

  const jobRef = db.collection("notificationJobs").doc(jobId);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) {
    return;
  }

  const job = jobSnap.data();

  if (job.status === "sent") {
    return;
  }

  const recipients = await getRecipients(job);

  const notificationId =
    job.notificationId ||
    jobId;

  const title =
    job.title ||
    "CampusOne NGC";

  const body =
    job.body ||
    "You have a new notification.";

  const image =
    job.image ||
    null;

  const url =
    job.url ||
    "./";

  const tokenList = [];

  for (const user of recipients) {

    const notificationRef = db
      .collection("userNotifications")
      .doc(user.uid)
      .collection("items")
      .doc(notificationId);

    await notificationRef.set({
      title,
      body,
      image,
      url,
      type: job.type || "general",
      createdAt: FieldValue.serverTimestamp(),
      read: false
    });

    const tokenSnap = await db
      .collection("users")
      .doc(user.uid)
      .collection("fcmTokens")
      .get();

    tokenSnap.forEach((tokenDoc) => {
      const tokenData = tokenDoc.data();

      if (tokenData.token) {
        tokenList.push({
          token: tokenData.token,
          uid: user.uid,
          tokenId: tokenDoc.id
        });
      }
    });
  }

  const uniqueTokens = [
    ...new Map(
      tokenList.map((item) => [
        item.token,
        item
      ])
    ).values()
  ];

  const tokens = uniqueTokens.map(
    (item) => item.token
  );

  if (tokens.length > 0) {

    for (
      let i = 0;
      i < tokens.length;
      i += 500
    ) {

      const batch = tokens.slice(
        i,
        i + 500
      );

      const response =
        await messaging.sendEachForMulticast({
          tokens: batch,

          notification: {
            title,
            body,
            ...(image ? { image } : {})
          },

          data: {
            title,
            body,
            url,
            notificationId
          },

          webpush: {
            notification: {
              icon: image || "./logo.png"
            },

            fcmOptions: {
              link: url
            }
          }
        });

      for (
        let index = 0;
        index < response.responses.length;
        index++
      ) {

        const result =
          response.responses[index];

        if (!result.success) {

          const errorCode =
            result.error?.code || "";

          if (
            errorCode.includes(
              "registration-token-not-registered"
            ) ||
            errorCode.includes(
              "invalid-registration-token"
            )
          ) {

            const item =
              uniqueTokens[i + index];

            if (item) {

              await db
                .collection("users")
                .doc(item.uid)
                .collection("fcmTokens")
                .doc(item.tokenId)
                .delete()
                .catch(() => {});
            }
          }
        }
      }
    }
  }

  await jobRef.update({
    status: "sent",
    sentAt: FieldValue.serverTimestamp(),
    recipientCount: recipients.length,
    tokenCount: tokens.length
  });
}

exports.processNotificationJob =
  onDocumentCreated(
    "notificationJobs/{jobId}",
    async (event) => {

      const jobId =
        event.params.jobId;

      await processNotificationJob(jobId);
    }
  );

async function createNotificationJob(data) {

  const ref =
    await db
      .collection("notificationJobs")
      .add({
        ...data,
        status: "pending",
        createdAt:
          FieldValue.serverTimestamp()
      });

  return ref.id;
}

exports.notifyNewNotice =
  onDocumentCreated(
    "notices/{noticeId}",
    async (event) => {

      const data =
        event.data?.data();

      if (!data) {
        return;
      }

      await createNotificationJob({
        type: "notice",
        title: data.title || "New Notice",
        body:
          data.description ||
          "A new notice has been published.",
        image: data.image || null,
        url: "./",
        recipientType: "all"
      });
    }
  );

exports.notifyNewEvent =
  onDocumentCreated(
    "events/{eventId}",
    async (event) => {

      const data =
        event.data?.data();

      if (!data) {
        return;
      }

      await createNotificationJob({
        type: "event",
        title: data.title || "New Event",
        body:
          data.description ||
          "A new event has been published.",
        image: data.image || null,
        url: "./",
        recipientType: "all"
      });
    }
  );

exports.notifyNewMaterial =
  onDocumentCreated(
    "materials/{materialId}",
    async (event) => {

      const data =
        event.data?.data();

      if (!data) {
        return;
      }

      await createNotificationJob({
        type: "material",
        title: data.title || "New Study Material",
        body:
          data.description ||
          "A new study material has been added.",
        image: data.image || null,
        url: "./",
        recipientType: "all"
      });
    }
  );

exports.notifyPublishedResult =
  onDocumentUpdated(
    "results/{resultId}",
    async (event) => {

      const before =
        event.data?.before?.data();

      const after =
        event.data?.after?.data();

      if (!before || !after) {
        return;
      }

      if (
        before.published !== true &&
        after.published === true
      ) {

        await createNotificationJob({
          type: "result",
          title:
            after.title ||
            "New Result Published",
          body:
            "A new result has been published.",
          image:
            after.image ||
            null,
          url: "./",
          recipientType: "all"
        });
      }
    }
  );

exports.notifySupportReply =
  onDocumentUpdated(
    "supportTickets/{ticketId}",
    async (event) => {

      const before =
        event.data?.before?.data();

      const after =
        event.data?.after?.data();

      if (!before || !after) {
        return;
      }

      if (
        after.userId &&
        after.reply &&
        after.reply !== before.reply
      ) {

        await createNotificationJob({
          type: "support",
          title: "Support Reply",
          body:
            "Admin has replied to your support message.",
          url: "./",
          recipientType: "user",
          userId: after.userId
        });
      }
    }
  );
