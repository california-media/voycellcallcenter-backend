const User = require('../models/userModel'); // Your User Model

exports.disconnectGoogle = async (req, res) => {
    const userId = req.user._id;

    try {
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Clear Google account details
        user.googleId = undefined;
        user.googleEmail = undefined;
        user.googleAccessToken = undefined;
        user.googleRefreshToken = undefined;
        user.googleConnected = false;

        await user.save();

        res.json({ status: 'success', message: 'Google Disconnected' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to disconnect Google account', error: error.message });
    }
};

exports.disconnectMicrosoft = async (req, res) => {
    const userId = req.user._id;

    try {
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Clear Google account details
        user.microsoftId = undefined;
        user.microsoftEmail = undefined;
        user.microsoftAccessToken = undefined;
        user.microsoftConnected = false;

        await user.save();

        res.json({ status: 'success', message: 'Microsoft Disconnected' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to disconnect Microsoft account', error: error.message });
    }
};

exports.disconnectSMTP = async (req, res) => {
    const userId = req.user._id;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // ✅ Clear SMTP fields
        user.smtpHost = undefined;
        user.smtpPort = undefined;
        user.smtpUser = undefined;
        user.smtpPass = undefined;
        user.smtpSecure = undefined;
        user.smtpConnected = false;

        await user.save();

        res.json({
            status: 'success',
            message: 'SMTP Mail Disconnected'
        });

    } catch (error) {
        console.error('SMTP Disconnect Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to disconnect SMTP',
            error: error.message
        });
    }
};