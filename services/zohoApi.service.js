const axios = require("axios");
const { refreshZohoToken } = require("./zohoTokenManager.service");

const request = async ({ user, method, url, data }) => {
  console.log(`[ZohoApi] ${method.toUpperCase()} ${url}`);
  if (data) console.log("[ZohoApi] Request payload:", JSON.stringify(data, null, 2));
  try {
    const res = await axios({
      method,
      url,
      data,
      headers: {
        Authorization: `Zoho-oauthtoken ${user.zoho.accessToken}`,
      },
    });
    console.log(`[ZohoApi] Response status: ${res.status}`);
    return res;
  } catch (err) {
    console.error(`[ZohoApi] Request failed — status: ${err.response?.status}, body:`, JSON.stringify(err.response?.data, null, 2));
    // 🔁 Auto refresh on 401
    if (err.response?.status === 401) {
      console.log("[ZohoApi] 401 received — refreshing token and retrying");
      const newToken = await refreshZohoToken(user);
      const res = await axios({
        method,
        url,
        data,
        headers: {
          Authorization: `Zoho-oauthtoken ${newToken}`,
        },
      });
      console.log(`[ZohoApi] Retry response status: ${res.status}`);
      return res;
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
  console.log("[ZohoApi] searchByPhone — searching Leads for phone:", phone);
  try {
    const leadRes = await request({
      user,
      method: "get",
      url: `${user.zoho.apiBaseUrl}/crm/v2/Leads/search?criteria=(Phone:equals:${phone})`,
    });
    if (leadRes.data.data?.length) {
      console.log("[ZohoApi] searchByPhone — Lead found:", leadRes.data.data[0].id);
      return { module: "Leads", record: leadRes.data.data[0] };
    }
    console.log("[ZohoApi] searchByPhone — No Lead found");
  } catch (err) {
    console.error("[ZohoApi] searchByPhone Leads error:", err.response?.data || err.message);
  }

  console.log("[ZohoApi] searchByPhone — searching Contacts for phone:", phone);
  try {
    const contactRes = await request({
      user,
      method: "get",
      url: `${user.zoho.apiBaseUrl}/crm/v2/Contacts/search?criteria=(Phone:equals:${phone})`,
    });
    if (contactRes.data.data?.length) {
      console.log("[ZohoApi] searchByPhone — Contact found:", contactRes.data.data[0].id);
      return { module: "Contacts", record: contactRes.data.data[0] };
    }
    console.log("[ZohoApi] searchByPhone — No Contact found");
  } catch (err) {
    console.error("[ZohoApi] searchByPhone Contacts error:", err.response?.data || err.message);
  }

  return null;
};

// ✏️ UPDATE RECORD
const updateRecord = async ({ user, module, recordId, data }) => {
  console.log(`[ZohoApi] updateRecord — ${module} id=${recordId}`, JSON.stringify(data, null, 2));
  return request({
    user,
    method: "put",
    url: `${user.zoho.apiBaseUrl}/crm/v2/${module}/${recordId}`,
    data: { data: [data] },
  });
};

// ➕ CREATE LEAD
const createLead = async ({ user, data }) => {
  console.log("[ZohoApi] createLead — payload:", JSON.stringify(data, null, 2));
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
  console.log(`[ZohoApi] createTask — ${module} id=${recordId}, note:`, note);
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


const createMeeting = async ({ user, module, recordId, meeting }) => {
  console.log(`[ZohoApi] createMeeting — ${module} id=${recordId}`);
  console.log("[ZohoApi] createMeeting — raw meeting input:", JSON.stringify(meeting, null, 2));
  // meetingStartTime may be 12-hour "hh:mm A" (e.g. "02:30 PM") or 24-hour "HH:mm"
  const parseTime = (timeStr) => {
    if (!timeStr) return { hours: 0, minutes: 0 };
    const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = parseInt(ampmMatch[2], 10);
      const period = ampmMatch[3].toUpperCase();
      if (period === "AM" && hours === 12) hours = 0;
      if (period === "PM" && hours !== 12) hours += 12;
      return { hours, minutes };
    }
    const plainMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (plainMatch) {
      return { hours: parseInt(plainMatch[1], 10), minutes: parseInt(plainMatch[2], 10) };
    }
    return { hours: 0, minutes: 0 };
  };

  const { hours, minutes } = parseTime(meeting.meetingStartTime);
  console.log(`[ZohoApi] createMeeting — parsed time: hours=${hours}, minutes=${minutes}`);
  const startDateTime = new Date(meeting.meetingStartDate);
  startDateTime.setHours(hours, minutes, 0, 0);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);
  console.log(`[ZohoApi] createMeeting — startDateTime: ${startDateTime.toISOString()}, endDateTime: ${endDateTime.toISOString()}`);

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
