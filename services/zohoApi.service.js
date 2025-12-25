const axios = require("axios");
const { refreshZohoToken } = require("./zohoTokenManager.service");

const request = async ({ user, method, url, data }) => {
  try {
    return await axios({
      method,
      url,
      data,
      headers: {
        Authorization: `Zoho-oauthtoken ${user.zoho.accessToken}`,
      },
    });
  } catch (err) {
    // 🔁 Auto refresh on 401
    if (err.response?.status === 401) {
      const newToken = await refreshZohoToken(user);

      return axios({
        method,
        url,
        data,
        headers: {
          Authorization: `Zoho-oauthtoken ${newToken}`,
        },
      });
    }
    throw err;
  }
};

const getZohoCurrentUser = async (user) => {
  if (!user.zoho?.accessToken) {
    throw new Error("Zoho access token missing");
  }

  const res = await axios.get(
    `${user.zoho.apiBaseUrl}/crm/v2/users?type=CurrentUser`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${user.zoho.accessToken}`,
      },
    }
  );

  return res.data.users[0];
};


// 🔍 SEARCH BY PHONE
const searchByPhone = async ({ user, phone }) => {
  try {
    const leadRes = await request({
      user,
      method: "get",
      // url: `${user.zoho.apiBaseUrl}/crm/v2/Leads/search?phone=${phone}`,
      url: `${user.zoho.apiBaseUrl}/crm/v2/Leads/search?criteria=(Phone:equals:${phone})`,
    });

    if (leadRes.data.data?.length) {
      return { module: "Leads", record: leadRes.data.data[0] };
    }
  } catch (err) {
    console.error("Zoho Lead search error:", err.response?.data || err.message);
  }


  try {
    const contactRes = await request({
      user,
      method: "get",
      // url: `${user.zoho.apiBaseUrl}/crm/v2/Contacts/search?phone=${phone}`,
      url: `${user.zoho.apiBaseUrl}/crm/v2/Contacts/search?criteria=(Phone:equals:${phone})`,
    });

    if (contactRes.data.data?.length) {
      return { module: "Contacts", record: contactRes.data.data[0] };
    }
  } catch (err) {
    console.error("Zoho Lead search error:", err.response?.data || err.message);
  }


  return null;
};

// ✏️ UPDATE RECORD
const updateRecord = async ({ user, module, recordId, data }) => {
  return request({
    user,
    method: "put",
    // url: `${user.zoho.apiBaseUrl}/crm/v2/${module}`,
    // data: { data: [{ id: recordId, ...data }] },
    url: `${user.zoho.apiBaseUrl}/crm/v2/${module}/${recordId}`,
    data: { data: [data] },
  });
};

// ➕ CREATE LEAD
const createLead = async ({ user, data }) => {
  return request({
    user,
    method: "post",
    url: `${user.zoho.apiBaseUrl}/crm/v2/Leads`,
    data: { data: [data] },
  });
};

// 📝 CREATE TASK

// const createTask = async ({ user, module, recordId, note }) => {
//   return request({
//     user,
//     method: "post",
//     url: `${user.zoho.apiBaseUrl}/crm/v2/Tasks`,
//     data: {
//       data: [
//         {
//           Subject: "Call Note",
//           Description: note,

//           ...(module === "Contacts" || module === "Leads"
//             ? { Who_Id: recordId }
//             : { What_Id: recordId, $se_module: module }),
//         },
//       ],
//     },
//   });
// };

const createTask = async ({ user, module, recordId, note }) => {
  console.log("note:", note, "module:", module, "recordId:", recordId, "user:", user);
  return request({
    user,
    method: "post",
    url: `${user.zoho.apiBaseUrl}/crm/v2/Tasks`,
    data: {
      data: [
        {
          Subject: "Call Note",
          Description: note,

          ...(module === "Contacts"
            ? { Who_Id: recordId }
            : { What_Id: recordId, $se_module: "Leads" }),
        },
      ],
    },
  });
};




// 📅 CREATE MEETING
// const createMeeting = async ({ user, module, recordId, meeting }) => {
//   const startDateTime = new Date(
//     `${meeting.meetingStartDate}T${meeting.meetingStartTime}:00`
//   );

//   // 🔥 force future (avoid closed meeting)
//   startDateTime.setMinutes(startDateTime.getMinutes() + 10);

//   const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);

//   const timezone =
//     user.zoho.timezone?.includes("/") ? user.zoho.timezone : "Asia/Kolkata";

//   const formatZohoDateTime = (date) => {
//     const pad = (n) => String(n).padStart(2, "0");
//     return (
//       `${date.getFullYear()}-` +
//       `${pad(date.getMonth() + 1)}-` +
//       `${pad(date.getDate())}T` +
//       `${pad(date.getHours())}:` +
//       `${pad(date.getMinutes())}:00`
//     );
//   };

//   const res = await request({
//     user,
//     method: "post",
//     url: `${user.zoho.apiBaseUrl}/crm/v2/Events`,
//     data: {
//       data: [
//         {
//           Event_Title: meeting.meetingTitle || "Follow-up Call",
//           Description: meeting.meetingDescription || "",

//           Start_DateTime: formatZohoDateTime(startDateTime),
//           End_DateTime: formatZohoDateTime(endDateTime),

//           Owner: { id: user.zoho.userId },
//           $timezone: timezone,

//           // 🔥 REQUIRED
//           Who_Id: recordId,

//           // 🔥 REQUIRED FOR INVITE
//           Participants: [
//             {
//               type: module === "Contacts" ? "contact" : "lead",
//               participant: recordId,
//             },
//           ],

//           Send_Invitation: true,
//         },
//       ],
//     },
//   });

//   console.log("Zoho Meeting Response:", res.data);
//   return res;
// };

const createMeeting = async ({ user, module, recordId, meeting }) => {
  console.log("meeting:", meeting, "module:", module, "recordId:", recordId, "user:", user);
  const startDateTime = new Date(
    `${meeting.meetingStartDate}T${meeting.meetingStartTime}:00`
  );
  startDateTime.setMinutes(startDateTime.getMinutes() + 10);

  const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);

  const formatZohoDateTime = (date) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
  };

  const linkFields =
    module === "Contacts"
      ? { Who_Id: recordId }
      : { What_Id: recordId, $se_module: "Leads" };

  return request({
    user,
    method: "post",
    url: `${user.zoho.apiBaseUrl}/crm/v2/Events`,
    data: {
      data: [
        {
          Event_Title: meeting.meetingTitle || "Follow-up Call",
          Description: meeting.meetingDescription || "",
          Start_DateTime: formatZohoDateTime(startDateTime),
          End_DateTime: formatZohoDateTime(endDateTime),
          Owner: { id: user.zoho.userId },
          $timezone: user.zoho.timezone || "Asia/Kolkata",
          ...linkFields,
          Send_Invitation: true,
        },
      ],
    },
  });
};


module.exports = {
  searchByPhone,
  updateRecord,
  createLead,
  createTask,
  createMeeting,
  getZohoCurrentUser,
};
