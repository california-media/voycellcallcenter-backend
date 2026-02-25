# Voycell Call Center Backend - Comprehensive API Documentation

## 1. Introduction
This document provides full technical documentation for the Voycell Call Center Backend API. It is designed to be the primary reference for developers, quality assurance teams, and system administrators. The API is built with a serverless architecture on AWS, using Node.js and MongoDB.

### 1.1 Base URLs
- **Production**: `https://nf6fp9tcn6.execute-api.eu-north-1.amazonaws.com`
- **Local Development**: `http://localhost:4004`

### 1.2 Authentication
The API uses **JWT (JSON Web Token)** for authentication.
- All protected endpoints require an `Authorization` header: `Bearer <your_token>`.
- Public endpoints (Signup, Login, Magic Link) do not require authentication.

---

## 2. User Roles & Permissions
The system uses Role-Based Access Control (RBAC):
- **Super Admin**: Full system access, PBX cluster management, global user administration.
- **Company Admin**: Manage company-specific agents, integrations, and high-level reports.
- **User (Agent)**: Core operational access to contacts, calls, and messages.

---

## 3. API Reference

### 3.1 Authentication
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/user/signup/email` | Company Admin registration. |
| POST | `/user/login` | Secure login to obtain JWT. |
| POST | `/user/verify-phone-number` | OTP verification for phone numbers. |
| POST | `/user/generateMagicLink` | Send a magic login link to email. |
| POST | `/auth/magic-link` | Login via magic link token. |
| GET | `/auth/verify-magic-link` | Verify validity of a magic link. |
| POST | `/auth/logout-all-devices` | Global logout from all active sessions. |
| POST | `/user/logout` | Invalidate current session. |
| POST | `/user/verifyEmailChange` | Confirm email address update. |

### 3.2 User Profile
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| GET | `/getUser` | Fetch full profile of current user. |
| POST | `/editProfile` | Update basic info and profile picture (Multipart). |
| POST | `/changePassword` | Change account password. |
| POST | `/changePassword/sip-secret` | Update SIP extension password. |
| POST | `/addEditTemplete` | Manage message templates (WhatsApp/Email). |

### 3.3 CRM - Contacts & Leads
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/addEditContactLeads` | Create or update a Contact/Lead (Multipart). |
| POST | `/getAllContactsOrLeads` | Paginated list of all company contacts. |
| POST | `/getAllContactsOrLeads/single` | Fetch a single contact by ID. |
| GET | `/getAllContactsOrLeads/searchByPhone` | Lookup contact by phone number. |
| GET | `/getAllContactsOrLeads/ForEvent` | Search contacts for event scheduling. |
| POST | `/addEditContactLeads/batch-delete` | Delete multiple contacts at once. |
| PUT | `/addEditContactLeads/toggle-favorite` | Mark/Unmark as favorite. |
| POST | `/save-bulk-contacts` | Import contacts in bulk. |
| GET | `/getContactActivities` | Chronological activity timeline for a contact. |

### 3.4 CRM - Tags & Categories
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| GET | `/tag/getTagsOfUser` | List all tags created by current user. |
| POST | `/tag/assignedToMultipleContacts` | Batch assign tags. |
| POST | `/tag/addTagToUser` | Create a new global tag definition. |
| DELETE | `/tag/deleteTagOfUser` | Remove a tag definition. |
| PUT | `/tag/editTagOfUser` | Update tag name/emoji. |
| GET | `/tag/getTagWithContact` | List tags associated with a specific contact. |

### 3.5 CRM - Tasks & Meetings
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/task/addEdit` | Create or update a CRM task. |
| GET | `/meeting/getAll` | List all scheduled meetings. |
| DELETE | `/meeting/deleteMeeting` | Cancel a meeting. |

### 3.6 WhatsApp & WABA (WhatsApp Business API)
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/api/whatsapp/send-message` | Send text or media messages (Multipart). |
| POST | `/api/whatsapp/send-template` | Send official Meta templates. |
| POST | `/api/whatsapp/send-campaign` | Trigger bulk message campaigns. |
| POST | `/api/whatsapp/conversations` | List all active chat threads. |
| POST | `/api/whatsapp/messages` | Fetch message history for a specific chat. |
| GET | `/api/whatsapp/approved-templates`| Sync templates from Meta dashboard. |
| POST | `/api/whatsapp/connect` | Link WhatsApp account to system. |
| POST | `/api/whatsapp/disconnect` | Remove WhatsApp integration. |
| POST | `/api/whatsapp/refresh-token` | Internal token maintenance. |

### 3.7 Yeastar PBX (Voice Communications)
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/api/yeastar/make-call` | Initiate Click-to-Call sequence. |
| POST | `/call/company-call-history` | Admin view of all company calls. |
| POST | `/call/agent-call-history` | Personal call logs for an agent. |
| POST | `/call/phone-number-call-history`| Interaction history with a specific number. |
| POST | `/call/dashboard-call-history` | High-level stats for dashboard graphs. |
| POST | `/call/recording` | Generate signed URL for call recordings. |
| GET | `/call/inbound-outbound-graph` | Data for call volume visualization. |
| POST | `/call/incoming-call-webhook` | Handles live PBX events. |

### 3.8 Connections & Integrations
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/connect/google` | Link Google account (Contacts/Calendar). |
| GET | `/fetch-google-contacts` | Manual sync of Google contacts. |
| POST | `/connect/smtp` | Configure custom email outgoing server. |
| POST | `/api/zoho/connect` | Link Zoho CRM. |
| GET | `/fetch-zoho-contacts` | Sync contacts from Zoho. |
| GET | `/fetch-hubspot-contacts` | Sync contacts from HubSpot. |
| POST | `/connect/microsoft` | Link Microsoft/Outlook account. |
| POST | `/connect/zoom` | Link Zoom for video meetings. |

### 3.9 Super Admin (System Governance)
| Method | Endpoint | Summary |
| :--- | :--- | :--- |
| POST | `/superAdmin/allCompanyAdmin` | Audit list of all company owners. |
| POST | `/superAdmin/addPBXDevice` | Setup a new PBX server cluster. |
| GET | `/superAdmin/getAllPBXDevices` | List all managed PBX instances. |
| POST | `/deleteUser/suspend` | Deactivate user access globally. |
| POST | `/admin/user/changeStatus` | Update account status (Active/Inactive). |
| POST | `/admin/user/delete` | Delete a user account. |
| POST | `/admin/bulk-delete` | Mass deletion of accounts. |
| GET | `/admin/pbx/details` | Individual PBX cluster details. |
| GET | `/admin/pbx/allDevices` | Detailed PBX cluster status. |
| POST | `/admin/pbx/deleteDevice` | Remove a PBX instance. |
| PUT | `/admin/pbx/toggleDeviceStatus` | Enable/Disable a PBX device. |

---

## 4. Detailed API Payload Declarations

### 4.1 Contact Creation (POST `/addEditContactLeads`)
**Type**: `multipart/form-data`
- `contact_id`: (String) Optional, for updates.
- `category`: (String) "contact" or "lead".
- `firstname`: (String) First name.
- `lastname`: (String) Last name.
- `emailAddresses`: (String) JSON stringified array of emails.
- `phoneNumbers`: (String) JSON stringified array of phone number objects `{ "countryCode": "+1", "number": "123456" }`.
- `notes`: (String) Internal notes.
- `contactImage`: (File) Profile image upload.

### 4.2 Send WhatsApp Message (POST `/api/whatsapp/send-message`)
**Type**: `multipart/form-data`
- `to`: (String) Destination phone number.
- `message`: (String) Plain text body.
- `file`: (File) Optional media attachment.

### 4.3 PBX Call Initiation (POST `/api/yeastar/make-call`)
**Type**: `application/json`
```json
{
  "caller_extension": "101",
  "mob_number": "9876543210",
  "assignedDeviceId": "PBX_CLUSTER_A"
}
```

---

## 5. Data Schemas

### 4.1 User Object
```json
{
  "_id": "string",
  "firstname": "string",
  "lastname": "string",
  "email": "string",
  "role": "user | companyAdmin | superadmin",
  "isActive": "boolean",
  "lastSeen": "ISO Date String"
}
```

### 4.2 Contact Object
```json
{
  "contact_id": "string",
  "firstname": "string",
  "lastname": "string",
  "emailAddresses": ["string"],
  "phoneNumbers": [
    { "countryCode": "string", "number": "string" }
  ],
  "status": "string",
  "isLead": "boolean",
  "tags": ["Tag Object"]
}
```

---

## 5. Documentation Conversion
To generate a Word document from this Markdown file:
1. **VS Code Extension**: Use "Markdown to Docx" extension.
2. **Command Line**: Run `pandoc Voycell_Backend_Documentation.md -o Voycell_Backend_Documentation.docx`.
3. **Online Tools**: Use CloudConvert or any MD-to-DOCX web tool.
