module.exports = (req, res, next) => {
  const secretFromHeader = req.headers["x-pabbly-secret"];

  if (!secretFromHeader) {
    return res.status(401).json({
      status: "error",
      message: "Missing Pabbly secret"
    });
  }

  if (secretFromHeader !== process.env.PABBLY_WEBHOOK_SECRET) {
    return res.status(401).json({
      status: "error",
      message: "Unauthorized webhook"
    });
  }

  next();
};
