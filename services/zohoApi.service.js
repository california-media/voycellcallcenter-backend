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
//           What_Id: recordId,
//           $se_module: module,
//         },
//       ],
//     },
//   });
// };
const createTask = async ({ user, module, recordId, note }) => {
  return request({
    user,
    method: "post",
    url: `${user.zoho.apiBaseUrl}/crm/v2/Tasks`,
    data: {
      data: [
        {
          Subject: "Call Note",
          Description: note,

          ...(module === "Contacts" || module === "Leads"
            ? { Who_Id: recordId }
            : { What_Id: recordId, $se_module: module }),
        },
      ],
    },
  });
};



// 📅 CREATE MEETING
// const createMeeting = async ({ user, module, recordId, meeting }) => {
//   return request({
//     user,
//     method: "post",
//     url: `${user.zoho.apiBaseUrl}/crm/v2/Events`,
//     data: {
//       data: [
//         {
//           Event_Title: meeting.meetingTitle || "Call Follow-up",
//           Start_DateTime: `${meeting.meetingStartDate}T${meeting.meetingStartTime}`,
//           What_Id: recordId,
//           $se_module: module,
//         },
//       ],
//     },
//   });
// };

// const createMeeting = async ({ user, module, recordId, meeting }) => {
//   // const start = `${meeting.meetingStartDate}T${meeting.meetingStartTime}:00`;
//   // const end = `${meeting.meetingStartDate}T${meeting.meetingStartTime}:00`;

//   const startDateTime = new Date(
//     `${meeting.meetingStartDate}T${meeting.meetingStartTime}:00`
//   );

//   const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);

//   const start = startDateTime.toISOString();
//   const end = endDateTime.toISOString();


//   return request({
//     user,
//     method: "post",
//     url: `${user.zoho.apiBaseUrl}/crm/v2/Events`,
//     data: {
//       data: [
//         {
//           Subject: meeting.meetingTitle || "Call Follow-up",
//           Start_DateTime: start,
//           End_DateTime: end,
//           Venue: meeting.meetingLocation || "",

//           ...(module === "Contacts" || module === "Leads"
//             ? { Who_Id: recordId }
//             : { What_Id: recordId, $se_module: module }),
//         },
//       ],
//     },
//   });
// };

const createMeeting = async ({ user, module, recordId, meeting }) => {
  const startDateTime = new Date(
    `${meeting.meetingStartDate}T${meeting.meetingStartTime}:00`
  );

  const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);

  const timezone = user.zoho.timezone || "UTC"; // safe fallback

  return request({
    user,
    method: "post",
    url: `${user.zoho.apiBaseUrl}/crm/v2/Events`,
    data: {
      data: [
        {
          Subject: meeting.meetingTitle || "Call Follow-up",
          Description: meeting.meetingDescription || "",
          Start_DateTime: startDateTime.toISOString(),
          End_DateTime: endDateTime.toISOString(),
          Venue: meeting.meetingLocation || "",

          $timezone: timezone,

          ...(module === "Contacts" || module === "Leads"
            ? { Who_Id: recordId }
            : { What_Id: recordId, $se_module: module }),
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
