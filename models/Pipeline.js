const { Schema, model, mongoose } = require("mongoose");

const pipelineSchema = new Schema(
    {
        lead_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Contact",
            required: true,
        },
        previousStatus: {
            type: String,
            enum: ["interested", "notInterested", "called", "notValid", "contacted", "win", "lost", null],
        },
        currentStatus: {
            type: String,
            enum: ["interested", "contacted", "win", "lost"],
            required: true,
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        note: {
            type: String,
        },
    },
    { timestamps: true }
);

module.exports = model("Pipeline", pipelineSchema);
