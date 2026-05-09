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
  const minimalTarget = {
    Arn:    process.env.SCHEDULE_LAMBDA_ARN,
    RoleArn: process.env.SCHEDULER_ROLE_ARN,
    Input:  JSON.stringify({ type: "SEND_EMAIL_BATCH", ...payload }),
  };

  const baseParams = {
    Name:                 `email-batch-${jobId}-${batchIndex}`,
    GroupName:            "default",
    ScheduleExpression:   `at(${scheduleTime})`,
    FlexibleTimeWindow:   { Mode: "OFF" },
    ActionAfterCompletion: "DELETE",
  };

  console.log(`[EmailBatch] Creating schedule for batch ${batchIndex} at ${scheduleTime} | LambdaARN: ${process.env.SCHEDULE_LAMBDA_ARN ? "SET" : "NOT SET"} | RoleARN: ${process.env.SCHEDULER_ROLE_ARN ? "SET" : "NOT SET"} | DLQ: ${process.env.SCHEDULER_DLQ_ARN ? "SET" : "NOT SET"}`);

  // ── Attempt 1: with DLQ + RetryPolicy (preferred, if DLQ is configured) ──
  if (process.env.SCHEDULER_DLQ_ARN) {
    try {
      await client.send(new CreateScheduleCommand({
        ...baseParams,
        Target: {
          ...minimalTarget,
          RetryPolicy:       { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
          DeadLetterConfig:  { Arn: process.env.SCHEDULER_DLQ_ARN },
        },
      }));
      console.log(`[EmailBatch] ✅ Schedule created with DLQ for batch ${batchIndex}`);
      return;
    } catch (dlqErr) {
      console.warn(`[EmailBatch] ⚠️  DLQ attempt failed for batch ${batchIndex}: [${dlqErr.name}] ${dlqErr.message} — falling back to minimal schedule`);
    }
  }

  // ── Attempt 2: minimal fallback — EXACTLY the same as the original working code ──
  // No RetryPolicy, no DLQ. This is what was working before the DLQ was added.
  try {
    await client.send(new CreateScheduleCommand({
      ...baseParams,
      Target: minimalTarget,
    }));
    console.log(`[EmailBatch] ✅ Schedule created (minimal) for batch ${batchIndex}`);
  } catch (fallbackErr) {
    console.error(`[EmailBatch] ❌ Minimal fallback ALSO failed for batch ${batchIndex}: [${fallbackErr.name}] ${fallbackErr.message}`);
    console.error(`[EmailBatch]    scheduleTime: ${scheduleTime}`);
    console.error(`[EmailBatch]    SCHEDULE_LAMBDA_ARN: ${process.env.SCHEDULE_LAMBDA_ARN}`);
    console.error(`[EmailBatch]    SCHEDULER_ROLE_ARN:  ${process.env.SCHEDULER_ROLE_ARN}`);
    throw fallbackErr; // re-throw so the controller marks this batch as failed
  }
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
