    // ---------- Handle Meeting ----------
    const timezone = req.body.timezone || "UTC"; // ✅ Get timezone from user if provided
    const meetingProvided =
      meetingTitle ||
      meetingDescription ||
      meetingStartDate ||
      meetingStartTime ||
      meetingType;
    let meetingObj = null; // ✅ This line fixes your error

    if (meetingProvided) {
      // ✅ For online meeting: Check Google connection
      if (meetingType === "online") {
        if (!user.googleAccessToken || !user.googleRefreshToken) {
          return res.status(400).json({
            status: "error",
            message:
              "Connect Google Account For Online Meeting Scheduling.",
          });
        }
      }

      meetingObj = {};
      if (meeting_id) {
        meetingObj.meeting_id = new mongoose.Types.ObjectId(meeting_id);

        // ✅ Handle edit logic for existing meeting
        const existingMeeting = await Contact.findOne(
          {
            _id: contact_id,
            createdBy: req.user._id,
            "meetings.meeting_id": meeting_id,
          },
          { "meetings.$": 1 }
        );

        if (
          existingMeeting &&
          existingMeeting.meetings &&
          existingMeeting.meetings.length > 0
        ) {
          const oldMeeting = existingMeeting.meetings[0];
          const oldType = oldMeeting.meetingType;

          // ✅ Step 1: Fill meetingObj with incoming request body values BEFORE type change check
          if (meetingTitle) meetingObj.meetingTitle = meetingTitle;
          if (meetingDescription)
            meetingObj.meetingDescription = meetingDescription;
          if (meetingStartDate) meetingObj.meetingStartDate = meetingStartDate;
          if (meetingStartTime) meetingObj.meetingStartTime = meetingStartTime;
          if (meetingType) meetingObj.meetingType = meetingType;
          if (meetingType === "offline" && meetingLocation) {
            meetingObj.meetingLocation = meetingLocation;
          }
          meetingObj.updatedAt = new Date();

          // ✅ ---- Type change: Offline → Online ----
          if (oldType === "offline" && meetingType === "online") {
            try {
              if (!meetingObj.meetingStartDate) {
                console.error(
                  "Start Date missing during offline → online type change"
                );
              } else {
                const generatedLink = await createGoogleMeetEvent(
                  user,
                  meetingObj,
                  timezone
                );
                if (generatedLink) {
                  meetingObj.meetingLink = generatedLink;
                }
              }
            } catch (error) {
              console.error(
                "Failed to create Google Meet link during type change:",
                error
              );
            }
            meetingObj.meetingLocation = undefined; // Clear location
          }

          // ✅ ---- Type change: Online → Offline ----
          if (oldType === "online" && meetingType === "offline") {
            meetingObj.meetingLink = undefined; // Remove Google Meet link
            if (meetingLocation) {
              meetingObj.meetingLocation = meetingLocation;
            }
          }

          // ✅ ---- Online → Online (Don't change meeting link) ----
          if (oldType === "online" && meetingType === "online") {
            delete meetingObj.meetingLink;
          }

          // ✅ ---- Offline → Offline ----
          if (oldType === "offline" && meetingType === "offline") {
            delete meetingObj.meetingLink;
            meetingObj.meetingLocation = meetingLocation || ""; // ✅ Store blank instead of skipping
          }
        }
      } else {
        // ✅ New meeting creation
        meetingObj.meeting_id = new mongoose.Types.ObjectId();
        meetingObj.createdAt = new Date();

        // ✅ Fill meetingObj with new values
        if (meetingTitle) meetingObj.meetingTitle = meetingTitle;
        if (meetingDescription)
          meetingObj.meetingDescription = meetingDescription;
        if (meetingStartDate) meetingObj.meetingStartDate = meetingStartDate;
        if (meetingStartTime) meetingObj.meetingStartTime = meetingStartTime;
        if (meetingType) meetingObj.meetingType = meetingType;
        if (meetingType === "offline" && meetingLocation) {
          meetingObj.meetingLocation = meetingLocation;
        }

        // ✅ Google Meet creation for new meeting (if online)
        if (meetingType === "online") {
          try {
            if (!meetingObj.meetingStartDate) {
              console.error(
                "Meeting Start Date missing for new Google Meet creation!"
              );
            } else {
              const generatedLink = await createGoogleMeetEvent(
                user,
                meetingObj,
                timezone
              );
              if (generatedLink) {
                meetingObj.meetingLink = generatedLink;
              }
            }
          } catch (error) {
            console.error(
              "Failed to create Google Meet link for new meeting:",
              error
            );
          }
        }
      }
    }