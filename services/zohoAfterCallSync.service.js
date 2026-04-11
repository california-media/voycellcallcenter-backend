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

  console.log("[Zoho] zohoAfterCallSync started");
  console.log("[Zoho] Input — phone:", phone, "| status:", status, "| note:", note);
  console.log("[Zoho] Meeting payload:", JSON.stringify(meeting, null, 2));

  // ── 1. Get token ──────────────────────────────────────────────────────────
  try {
    token = await getValidZohoAccessToken(user);
    console.log("[Zoho] Token obtained via getValidZohoAccessToken");
  } catch (err) {
    console.warn("[Zoho] getValidZohoAccessToken failed, attempting refresh:", err.message);
    token = await refreshZohoToken(user);
    console.log("[Zoho] Token obtained via refreshZohoToken");
  }

  // ── 2. Search for existing Contact/Lead by phone ──────────────────────────
  console.log("[Zoho] Searching by phone:", phone);
  const found = await searchByPhone({ user, phone });
  console.log("[Zoho] searchByPhone result:", found ? `Found ${found.module} id=${found.record.id}` : "Not found");

  // ── 3. Map fields ─────────────────────────────────────────────────────────
  const zohoData = mapToZohoFields(targetDoc, status);
  console.log("[Zoho] Mapped fields:", JSON.stringify(zohoData, null, 2));

  let module, recordId;

  // ── 4. Update or create record ────────────────────────────────────────────
  if (found) {
    module = found.module;
    recordId = found.record.id;
    console.log(`[Zoho] Updating existing ${module} record id=${recordId}`);
    await updateRecord({ user, module, recordId, data: zohoData });
    console.log(`[Zoho] ${module} record updated successfully`);
  } else {
    console.log("[Zoho] No match found — creating new Lead");
    const res = await createLead({ user, data: zohoData });
    module = "Leads";
    recordId = res.data.data[0].details.id;
    console.log("[Zoho] New Lead created — id:", recordId);
  }

  // ── 5. Create Task (note) ─────────────────────────────────────────────────
  if (note && note.trim()) {
    console.log("[Zoho] Creating Task with note:", note);
    await createTask({ user, module, recordId, note });
    console.log("[Zoho] Task created successfully");
  } else {
    console.log("[Zoho] No note provided — skipping Task creation");
  }

  // ── 6. Create Meeting (Event) ─────────────────────────────────────────────
  const hasMeetingDate = meeting && meeting.meetingStartDate;
  const hasMeetingTime = meeting && meeting.meetingStartTime;
  console.log("[Zoho] Meeting guard check — meetingStartDate:", meeting?.meetingStartDate, "| meetingStartTime:", meeting?.meetingStartTime);

  if (hasMeetingDate && hasMeetingTime) {
    console.log("[Zoho] Creating Meeting (Event) in Zoho:", {
      module,
      recordId,
      meetingTitle: meeting.meetingTitle,
      meetingStartDate: meeting.meetingStartDate,
      meetingStartTime: meeting.meetingStartTime,
    });
    try {
      const meetingRes = await createMeeting({ user, module, recordId, meeting });
      console.log("[Zoho] Meeting created successfully. Response:", JSON.stringify(meetingRes?.data, null, 2));
    } catch (err) {
      console.error("[Zoho] createMeeting failed:", err.response?.data || err.message);
    }
  } else {
    console.log("[Zoho] Meeting guard failed — skipping Event creation. meeting object:", JSON.stringify(meeting, null, 2));
  }

  console.log("[Zoho] zohoAfterCallSync completed");
};
