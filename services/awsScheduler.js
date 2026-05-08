const {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand, // ✅ ADD THIS
} = require("@aws-sdk/client-scheduler");

const client = new SchedulerClient({
  region: "eu-north-1",
});

const createCampaignSchedule = async ({
  campaignId,
  scheduleTime,
  payload,
}) => {

  const command = new CreateScheduleCommand({
    Name: `campaign-${campaignId}`,
    GroupName: "default",
    ScheduleExpression: `at(${scheduleTime})`, // must be YYYY-MM-DDTHH:MM:SS
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: process.env.SCHEDULE_LAMBDA_ARN,
      RoleArn: process.env.SCHEDULER_ROLE_ARN,
      Input: JSON.stringify(payload),
    },
  });

  await client.send(command);
};

const deleteCampaignSchedule = async (campaignId) => {
  try {
    const command = new DeleteScheduleCommand({
      Name: `campaign-${campaignId}`,
      GroupName: "default",
    });

    await client.send(command);

    console.log(`✅ Schedule deleted for campaign ${campaignId}`);
  } catch (error) {
    console.error("❌ Error deleting schedule:", error.message);
  }
};



// ── Email batch schedules ─────────────────────────────────────────────────────

/**
 * Schedule one email batch.
 * Name format: email-batch-{jobId}-{batchIndex}
 * The Lambda will receive event.type === "SEND_EMAIL_BATCH"
 */
const createEmailBatchSchedule = async ({ jobId, batchIndex, scheduleTime, payload }) => {
  // Build the Target — conditionally include DLQ only if the ARN is configured
  const target = {
    Arn:     process.env.SCHEDULE_LAMBDA_ARN,
    RoleArn: process.env.SCHEDULER_ROLE_ARN,
    Input:   JSON.stringify({ type: "SEND_EMAIL_BATCH", ...payload }),
    // Retry up to 2 times if Lambda returns an error (not a timeout).
    // MaximumEventAgeInSeconds: discard the event after 1 hour so stale batches
    // don't fire hours later after an outage.
    RetryPolicy: {
      MaximumRetryAttempts:     2,
      MaximumEventAgeInSeconds: 3600, // 1 hour
    },
  };

  // Attach the per-schedule DLQ only when the ARN env var is set.
  // EventBridge Scheduler sends the failed event to this SQS queue after all
  // retries are exhausted, so no fired batch is ever silently lost.
  if (process.env.SCHEDULER_DLQ_ARN) {
    target.DeadLetterConfig = { Arn: process.env.SCHEDULER_DLQ_ARN };
  }

  const command = new CreateScheduleCommand({
    Name:             `email-batch-${jobId}-${batchIndex}`,
    GroupName:        "default",
    ScheduleExpression: `at(${scheduleTime})`,   // YYYY-MM-DDTHH:MM:SS  (UTC)
    FlexibleTimeWindow: { Mode: "OFF" },
    // Auto-delete the schedule after it fires — keeps things clean
    ActionAfterCompletion: "DELETE",
    Target: target,
  });
  await client.send(command);
};

const deleteEmailBatchSchedule = async (jobId, batchIndex) => {
  try {
    const command = new DeleteScheduleCommand({
      Name:      `email-batch-${jobId}-${batchIndex}`,
      GroupName: "default",
    });
    await client.send(command);
  } catch (err) {
    console.error(`[EmailBatch] Error deleting schedule ${jobId}-${batchIndex}:`, err.message);
  }
};

module.exports = {
  createCampaignSchedule,
  deleteCampaignSchedule,
  createEmailBatchSchedule,
  deleteEmailBatchSchedule,
};
