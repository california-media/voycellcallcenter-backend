const mongoose = require("mongoose");

const incomingcallConnectionSchema = new mongoose.Schema(
  {
    connectionId: {
      type: String,
      required: true,
      unique: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

const IncomingcallConnection =
  mongoose.models.incomingcallConnection ||
  mongoose.model('incomingcallConnection', incomingcallConnectionSchema);

// export default IncomingcallConnection;
module.exports = IncomingcallConnection;