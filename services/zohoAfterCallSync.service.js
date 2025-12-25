const {
  searchByPhone,
  updateRecord,
  createLead,
  createTask,
  createMeeting,
} = require("./zohoApi.service");

const { getValidZohoAccessToken, refreshZohoToken } = require("./zohoTokenManager.service");
const { mapToZohoFields } = require("../utils/zohoFieldMapper");

exports.zohoAfterCallSync = async ({
  user,
  targetDoc,
  phone,
  status,
  note,
  meeting,
}) => {
  let token;

  try {
    token = await getValidZohoAccessToken(user);
    console.log("Zoho After Call Sync - Token:", token);
  } catch {
    token = await refreshZohoToken(user);
    console.log("Zoho After Call Sync - Refreshed Token:", token);
  }

  // const found = await searchByPhone({
  //   apiBaseUrl: user.zoho.apiBaseUrl,
  //   token,
  //   phone,
  // });

  const found = await searchByPhone({
    user,
    phone,
  });

  console.log("Zoho After Call Sync - Found:", found);


  const zohoData = mapToZohoFields(targetDoc, status);

  console.log("Zoho Data:", zohoData);


  let module, recordId;

  if (found) {
    module = found.module;
    recordId = found.record.id;
    console.log("Zoho After Call Sync - Updating Record:", module, recordId);
    // await updateRecord({
    //   apiBaseUrl: user.zoho.apiBaseUrl,
    //   token,
    //   module,
    //   recordId,
    //   data: zohoData,
    // });
    console.log("Zoho After Call Sync - Updating Record:", module, recordId, "with Data:", zohoData, "user:", user);
    await updateRecord({
      user,
      module,
      recordId,
      data: zohoData,
    });
    // console.log("Zoho Update Success:", response.data);
  } else {
    // const res = await createLead({
    //   apiBaseUrl: user.zoho.apiBaseUrl,
    //   token,
    //   data: zohoData,
    // });
    console.log("Zoho After Call Sync - Creating Lead with Data:", zohoData, "user:", user);
    const res = await createLead({
      user,
      data: zohoData,
    });
    console.log("Zoho Create Lead Success:", res.data);

    module = "Leads";
    recordId = res.data.data[0].details.id;
  }

  // if (note) {
  //   // await createTask({
  //   //   apiBaseUrl: user.zoho.apiBaseUrl,
  //   //   token,
  //   //   module,
  //   //   recordId,
  //   //   note,
  //   // });
  //   await createTask({
  //     user,
  //     module,
  //     recordId,
  //     note,
  //   });
  // }

  // if (meeting) {
  //   // await createMeeting({
  //   //   apiBaseUrl: user.zoho.apiBaseUrl,
  //   //   token,
  //   //   module,
  //   //   recordId,
  //   //   meeting,
  //   // });
  //   await createMeeting({
  //     user,
  //     module,
  //     recordId,
  //     meeting,
  //   });
  // }

  // ✅ CREATE TASK IN ZOHO
  if (note && note.trim()) {
    console.log("module:", module, "recordId:", recordId, "note:", note);
    await createTask({
      user,
      module,
      recordId,
      note,
    });
  }
  console.log("Zoho Task Creation Success");
  // ✅ CREATE MEETING IN ZOHO (GUARD ADDED HERE)
  if (
    meeting &&
    meeting.meetingStartDate &&
    meeting.meetingStartTime
  ) {
    console.log("module:", module, "recordId:", recordId, "meeting:", meeting);
    await createMeeting({
      user,
      module,
      recordId,
      meeting,
    });
    console.log("Zoho Meeting Creation Success");
  }
};
