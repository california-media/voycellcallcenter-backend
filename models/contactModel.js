const { Schema, model, mongoose } = require("mongoose");

const taskSchema = new Schema(
    {
        task_id: {
            type: mongoose.Types.ObjectId, // FIXED
            default: () => new mongoose.Types.ObjectId(), // FIXED
        },
        // taskTitle: String,
        taskDescription: String,
        taskDueDate: Date,
        taskDueTime: String,
        taskIsCompleted: { type: Boolean, default: false },
    },
    {
        timestamps: true,
        _id: false,
    }
);

const meetingSchema = new Schema(
    {
        meeting_id: {
            type: mongoose.Types.ObjectId,
            default: () => new mongoose.Types.ObjectId(),
        },
        meetingTitle: String,
        meetingDescription: String,
        meetingStartDate: Date,
        meetingStartTime: String,
        meetingType: {
            type: String,
            enum: ["online", "offline"],
            default: "offline",
        },
        meetingLink: String,
        meetingLocation: String,
    },
    { timestamps: true, _id: false }
);

const contactSchema = new Schema(
    {
        contact_id: {
            type: Schema.Types.ObjectId,
            // type: mongoose.Schema.Types.ObjectId,
            unique: true,
        },
        firstName: {
            type: String,
            // default: "Dummy firstName",
        },
        lastName: {
            type: String,
            // default: "Dummy lastName",
        },
        company: {
            type: String,
            // default: "Dummy lastName",
        },
        designation: {
            type: String,
            // default: "Dummy lastName",
        },
        emailAddresses: {
            type: [String],
        },
        notes: {
            type: String,
        },
        website: {
            type: String,
        },
        phoneNumbers: [
            {
                countryCode: {
                    type: String,
                },
                number: {
                    type: String,
                },
                _id: false,
            },
        ],

        status: {
            type: String,
            enum: ["interested", "notInterested", "called", "notValid", "contacted", "win", "lost"],
        },


        isLead: {
            type: Boolean,
            default: false,
        },

        contactImageURL: {
            type: String,
            default: "",
        },
        isFavourite: {
            type: Boolean,
            default: false,
        },
        tags: [
            {
                _id: false,
                tag_id: {
                    type: mongoose.Schema.Types.ObjectId,
                    default: () => new mongoose.Types.ObjectId(),
                },
                tag: {
                    type: String,
                    default: "VoyCell",
                },
                emoji: {
                    type: String, // URL to S3
                    default: "🏷️",
                },
                order: {
                    type: Number, // New field
                },
            },
        ],

        linkedin: {
            type: String,
            // default: "Dummy firstName",
        },
        instagram: {
            type: String,
            // default: "Dummy firstName",
        },
        telegram: {
            type: String,
            // default: "Dummy firstName",
        },
        twitter: {
            type: String,
            // default: "Dummy firstName",
        },
        facebook: {
            type: String,
            // default: "Dummy firstName",
        },

        tasks: [taskSchema],

        meetings: [meetingSchema],

        activities: [
            {
                _id: false,
                action: { type: String, required: true },
                type: {
                    type: String,
                    required: true,
                    enum: ["contact", "task", "meeting", "tag", "email", "whatsapp", "call"], // Optional but safer
                },
                title: { type: String },
                description: { type: String },
                timestamp: { type: Date, default: Date.now },
            }
        ],

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

const Contact = model("Contact", contactSchema);
module.exports = Contact;