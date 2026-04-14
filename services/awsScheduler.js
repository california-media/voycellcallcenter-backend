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



module.exports = {
  createCampaignSchedule,
  deleteCampaignSchedule, // ✅ ADD
};
