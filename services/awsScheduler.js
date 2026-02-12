const {
  SchedulerClient,
  CreateScheduleCommand,
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
    ScheduleExpression: `at(${scheduleTime})`,
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: process.env.SCHEDULE_LAMBDA_ARN,
      RoleArn: process.env.SCHEDULER_ROLE_ARN,
      Input: JSON.stringify(payload),
    },
  });

  await client.send(command);
};



module.exports = { createCampaignSchedule };
