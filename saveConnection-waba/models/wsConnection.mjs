import mongoose from 'mongoose';

const wsConnectionSchema = new mongoose.Schema(
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

const WsConnection =
  mongoose.models.wsConnection ||
  mongoose.model('wsConnection', wsConnectionSchema);

export default WsConnection;