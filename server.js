const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
require('dotenv').config();
const twilio = require('twilio');
const app = express();
app.use(cors());
app.use(express.json());

// Sequelize setup
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'mysql',
  dialectOptions: {
    ssl: { rejectUnauthorized: false }
  }
});


const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
//Shareholder Model
const Shareholder = sequelize.define('shareholders', {
  acno: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
  name: DataTypes.STRING,
 
  address: DataTypes.STRING,
  holdings: DataTypes.STRING,
  phone_number: DataTypes.STRING,
  email: DataTypes.STRING,
  chn: { type:Sequelize.STRING, allowNull: true },
  rin: DataTypes.STRING,
  hasVoted: { type: Sequelize.BOOLEAN, defaultValue: false, allowNull: false }
}, {
  timestamps: false,
  freezTableName: true
});

// Registered User Model
const RegisteredUser = sequelize.define('registeredusers', {
  name: DataTypes.STRING,
  acno: DataTypes.STRING,
  holdings: DataTypes.STRING,
  email: DataTypes.STRING,
  phone_number: DataTypes.STRING,
 chn: { type:Sequelize.STRING, allowNull: true },
  registered_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  
});

// Verification Token Model
const VerificationToken = sequelize.define('VerificationToken', {
  acno: { type: DataTypes.STRING, allowNull: false },
  token: { type: DataTypes.STRING, allowNull: false },
  email: DataTypes.STRING,
  phone_number: DataTypes.STRING,
  chn: { type:Sequelize.STRING, allowNull: true },
  expires_at: { type: DataTypes.DATE, allowNull: false }
}, {
  timestamps: false,
  freezeTableName: true
});

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});





// Updated check-shareholder route
app.post('/api/check-shareholder', async (req, res) => {
  const { searchTerm } = req.body;

  if (!searchTerm) {
    return res.status(400).json({ error: 'Please provide a search term.' });
  }

  try {
    // Check if searchTerm is numeric (account number)
    const isAccountNumber = /^\d+$/.test(searchTerm);

    if (isAccountNumber) {
      // Exact match for account numbers
      const shareholder = await Shareholder.findOne({ 
        where: { acno: searchTerm  } 
      });

      if (shareholder) {
        return res.json({
          status: 'account_match',
          shareholder: {
            name: shareholder.name,
            acno: shareholder.acno,
            email: shareholder.email,
            phone_number: shareholder.phone_number,
            chn:shareholder.chn
          }
        });
      }
    }
    const byChn = await Shareholder.findOne({ where: { chn: searchTerm } });
    if (byChn) {
      return res.json({
        status: 'chn_match',
        shareholder: {
          name: byChn.name,
          acno: byChn.acno,
          email: byChn.email,
          phone_number: byChn.phone_number,
          chn: byChn.chn
        }
      });
    }

    // For names, do partial search (randomized)
    const shareholders = await Shareholder.findAll({
      where: {
        name: { [Op.like]: `%${searchTerm}%` }
      },
      order: sequelize.random(), // Randomize name results
      limit: 10
    });

    if (shareholders.length > 0) {
      return res.json({
        status: 'name_matches',
        shareholders: shareholders.map(sh => ({
          name: sh.name,
          acno: sh.acno,
          email: sh.email,
          phone_number: sh.phone_number,
          chn: sh.chn
        }))
      });
    }

    return res.json({ 
      status: 'not_found', 
      message: 'No matching shareholders found.' 
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Send confirmation link via email
app.post('/api/send-confirmation', async (req, res) => {
  const { acno, email, phone_number } = req.body;


  
  try {

    const alreadyRegistered = await RegisteredUser.findOne({
      where: 
  
          { acno }
        
      
    });

    if (alreadyRegistered) {
      return res.status(400).json({ message: '❌ This shareholder is already registered with the same ACNO, Email, Phone Number or CHN.' });
    }

    const shareholder = await Shareholder.findOne({ where: { acno } });
    if (!shareholder) return res.status(404).json({ message: 'Shareholder not found' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await VerificationToken.create({ acno, token, email, phone_number, expires_at: expiresAt });

    const confirmUrl = `http://localhost:3001/api/confirm/${token}`;

    await transporter.sendMail({
      from: 'E-Voting Portal <your@email.com>',
      to: shareholder.email,
      subject: 'Confirm Your Registration',
      html: `
        <h2>🗳️ E-Voting Registration</h2>
        <p>Hello ${shareholder.name},</p>
        <p>Click the button below to confirm your registration:</p>
        <a href="${confirmUrl}" style="background-color:#1075bf;padding:12px 20px;color:#fff;text-decoration:none;border-radius:5px;">
          ✅ Confirm Registration
        </a>
        <p>If you didn’t request this, just ignore this email.</p>
      `
    });

    

    res.json({ message: '✅ Confirmation sent to email.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send confirmation.' });
  }
});

// Confirm registration
app.get('/api/confirm/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const pending = await VerificationToken.findOne({ where: { token } });

    if (!pending || new Date(pending.expires_at) < new Date()) {
      return res.status(400).send('❌ Invalid or expired token.');
    }

    // Fetch full shareholder details
    const shareholder = await Shareholder.findOne({ where: { acno: pending.acno } });

    if (!shareholder) {
      return res.status(404).send('❌ Shareholder not found.');
    }

    await RegisteredUser.create({
      name: shareholder.name,
      acno: shareholder.acno,
      email: shareholder.email,
      phone_number: shareholder.phone_number,
      registered_at: new Date(),
      holdings: shareholder.holdings,
      chn:shareholder.chn
    });

    await pending.destroy();


    // Add this endpoint to your existing server code

// Get all registered users with pagination
app.get('/api/registered-users', async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const pageSize = parseInt(req.query.pageSize) || 10; // Default to 10 items per page
    const offset = (page - 1) * pageSize;

    // Sorting parameters
    const sortBy = req.query.sortBy || 'registered_at'; // Default sort by registration date
    const sortOrder = req.query.sortOrder || 'DESC'; // Default descending order

    // Search filter
    const searchTerm = req.query.search || '';

    // Build the query conditions
    const whereConditions = {};
    if (searchTerm) {
      whereConditions[Op.or] = [
        { name: { [Op.like]: `%${searchTerm}%` } },
        { acno: { [Op.like]: `%${searchTerm}%` } },
        { email: { [Op.like]: `%${searchTerm}%` } },
        { phone_number: { [Op.like]: `%${searchTerm}%` } },
        { chn: { [Op.like]: `%${searchTerm}%` } }
      ];
    }

    // Get the total count for pagination info
    const totalCount = await RegisteredUser.count({ where: whereConditions });

    // Get the paginated results
    const users = await RegisteredUser.findAll({
      where: whereConditions,
      order: [[sortBy, sortOrder]],
      limit: pageSize,
      offset: offset,
      attributes: ['name', 'acno', 'email', 'phone_number', 'holdings','chn', 'registered_at'] // Select specific fields
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({
      success: true,
      data: users,
      pagination: {
        totalItems: totalCount,
        totalPages,
        currentPage: page,
        pageSize,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching registered users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch registered users',
      error: error.message
    });
  }
});
    // Send follow-up email
    await transporter.sendMail({
      from: '"E-Voting Portal" <your@email.com>',
      to: shareholder.email,
      subject: '✅ Successfully Registered for Voting',
      html: `
        <h2>🎉 Hello ${shareholder.name},</h2>
        <p>You have successfully registered for the upcoming e-voting session.</p>
        <p>✅ Your account is now active.</p>
        <h3>🗳️ Voting Instructions:</h3>
        <ul>
          <li>Visit the <a href="http://yourdomain.com/e-voting">E-Voting Portal</a></li>
          <li>Login using your registered email address: <strong>${shareholder.email}</strong></li> or <br> phone Number:<strong>${shareholder.phone_number}</strong>
          <li>Follow the prompts to cast your vote</li>
        </ul>
        <p>Thank you for participating!</p>
      `
    });

    res.redirect('http://localhost:5173/registration-success');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Start server
const PORT = process.env.PORT || 3001;
sequelize.sync().then(() => {
  console.log('✅ Database synced');
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
