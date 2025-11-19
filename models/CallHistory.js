const mongoose = require("mongoose");

const callHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    extensionNumber: {
      type: String,
      required: true,
    },

    // Yeastar CDR fields
    yeastarId: { type: String, required: true, unique: true }, // cdr.id
    call_from: String,
    call_to: String,
    talk_time: Number,
    ring_time: Number,
    duration: Number,
    direction: String,
    status: String,
    start_time: Date,
    end_time: Date,
    record_file: String,
    disposition_code: String,
    trunk: String,

  },
  { timestamps: true }
);

module.exports = mongoose.model("CallHistory", callHistorySchema);
