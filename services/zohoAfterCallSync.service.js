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
  } catch {
    token = await refreshZohoToken(user);
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


  const zohoData = mapToZohoFields(targetDoc, status);

  let module, recordId;

  if (found) {
    module = found.module;
    recordId = found.record.id;

    // await updateRecord({
    //   apiBaseUrl: user.zoho.apiBaseUrl,
    //   token,
    //   module,
    //   recordId,
    //   data: zohoData,
    // });
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

    const res = await createLead({
      user,
      data: zohoData,
    });


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
    await createTask({
      user,
      module,
      recordId,
      note,
    });
  }

  // ✅ CREATE MEETING IN ZOHO (GUARD ADDED HERE)
  if (
    meeting &&
    meeting.meetingStartDate &&
    meeting.meetingStartTime
  ) {
    await createMeeting({
      user,
      module,
      recordId,
      meeting,
    });
  }


};
