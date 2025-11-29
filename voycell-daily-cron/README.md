# Contacts Daily Cron - Subscription Expiry Alerts

This Lambda function sends email alerts to users whose subscriptions are about to expire. It's designed to be triggered by AWS EventBridge on a daily schedule.

## Overview

The function:

- Fetches all users with active subscriptions or trials
- Checks if their subscription expires in N days (configurable)
- Sends personalized email alerts to matched users
- Uses concurrency limiting to avoid rate limits with Stripe and email services

## Setup

### 1. Install Dependencies

```bash
cd contacts-daily-cron
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and update with your values:

```bash
cp .env.example .env
```

Required environment variables:

- `MONGO_URL` - MongoDB connection string
- `STRIPE_SECRET_KEY` - Stripe secret key for accessing subscription data
- `SMTP_USER` - SMTP email username
- `SMTP_PASS` - SMTP email password
- `DAYS_BEFORE_EXPIRY` - Number of days before expiry to send alert (default: 7)

### 3. Local Testing

Run the function locally:

```bash
node index.js
```

This will execute the subscription alert logic directly.

## AWS Deployment

### Lambda Configuration

1. **Runtime**: Node.js 18.x or higher
2. **Handler**: `index.handler`
3. **Timeout**: 5 minutes (300 seconds)
4. **Memory**: 512 MB or higher
5. **Environment Variables**: Set all required variables in Lambda configuration

### EventBridge Schedule

Set up an EventBridge rule to trigger this Lambda daily:

**Cron Expression** (runs daily at 9 AM UTC):

```
cron(0 9 * * ? *)
```

Or use a rate expression:

```
rate(1 day)
```

## How It Works

### 1. Database Connection

- Uses connection pooling for efficiency
- Reuses connections across Lambda invocations

### 2. User Fetching

- Queries users with `stripeCustomerId` or `trialEnd` set
- Only selects necessary fields to minimize data transfer

### 3. Subscription Checking

- Uses Stripe API to get active subscriptions
- Checks both trial end dates and subscription period ends
- Runs checks in parallel with concurrency limiting (5 concurrent Stripe calls)

### 4. Email Sending

- Sends personalized emails with user name and plan details
- Includes expiry date and renewal link
- Runs in parallel with concurrency limiting (10 concurrent emails)

### 5. Result Reporting

- Returns statistics on matched users, successful emails, and failures
- Logs all operations for CloudWatch monitoring

## Configuring Alert Timing

The `DAYS_BEFORE_EXPIRY` environment variable controls when alerts are sent:

- `DAYS_BEFORE_EXPIRY=7` - Alert 7 days before expiry (default)
- `DAYS_BEFORE_EXPIRY=3` - Alert 3 days before expiry
- `DAYS_BEFORE_EXPIRY=1` - Alert 1 day before expiry

You can deploy multiple instances of this Lambda with different configurations to send alerts at multiple intervals (e.g., 7 days, 3 days, and 1 day before expiry).

## Monitoring

### CloudWatch Logs

The function logs:

- ✅ Successful operations
- ❌ Errors and failures
- 📊 Statistics (total users processed, emails sent, failures)

### Sample Output

```json
{
  "success": true,
  "message": "Subscription expiry alerts processed successfully.",
  "totalMatchedUsers": 15,
  "successCount": 14,
  "failedCount": 1
}
```

## Project Structure

```
contacts-daily-cron/
├── index.js                          # Lambda handler
├── config/
│   └── stripe.js                     # Stripe configuration
├── models/
│   ├── userModel.js                  # User schema
│   └── planModel.js                  # Plan schema
├── services/
│   └── subscriptionAlertService.js   # Main alert logic
├── utils/
│   ├── sendEmail.js                  # Email utility
│   └── stripeUtils.js                # Stripe helper functions
├── package.json
├── .env.example
└── README.md
```

## Error Handling

- Database connection failures are logged and cause Lambda to fail
- Individual Stripe API errors are caught and logged, but don't stop processing
- Individual email failures are caught and counted in the failed count
- All errors include stack traces in development mode

## Performance Considerations

- **Concurrency Limiting**: Prevents overwhelming external APIs
- **Connection Pooling**: Reuses MongoDB connections
- **Selective Queries**: Only fetches necessary user fields
- **Parallel Processing**: Processes users and sends emails in parallel

## Security

- All sensitive credentials stored in environment variables
- No credentials in code
- SMTP uses TLS/SSL encryption
- MongoDB connection uses authentication

## Troubleshooting

### No emails sent

- Check CloudWatch logs for user matching
- Verify `DAYS_BEFORE_EXPIRY` matches expected expiry dates
- Ensure users have valid email addresses

### Stripe API errors

- Verify `STRIPE_SECRET_KEY` is correct
- Check Stripe API rate limits
- Ensure subscription data exists in Stripe

### Email delivery failures

- Verify SMTP credentials
- Check email service rate limits
- Validate recipient email addresses

## Future Enhancements

- Add support for multiple alert intervals in one function
- Implement DynamoDB tracking to avoid duplicate alerts
- Add SNS notifications for admin monitoring
- Support for different email templates per plan
