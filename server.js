const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
require('dotenv').config();
const twilio = require('twilio');
const app = express();
const TWILIO_ACCOUNT_SID= process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_ACCOUNT_TOKEN
const TWILIO_PHONE_NUMBER =process.env.TWILIO_PHONE_NUMBER

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);



// Add this phone number formatter function
function formatNigerianPhone(phone) {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Convert local numbers (starts with 0)
  if (cleaned.startsWith('0')) {
    return `+234${cleaned.substring(1)}`;
  }

  // Convert already national numbers (without +234)
  if (cleaned.startsWith('234') && cleaned.length === 13) {
    return `+${cleaned}`;
  }

  // Return as-is if already international format
  return phone;
}






// Sequelize setup

let sequelize;

if (process.env.NODE_ENV === 'production') {
  // Online database (PostgreSQL with SSL for production)
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    ssl: true,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 10000
    },
    logging: false
  });
} else {
  // Local database (MySQL or PostgreSQL without SSL)
  sequelize = new Sequelize(
    process.env.DB_NAME || 'your_local_db_name',
    process.env.DB_USER || 'your_local_db_user',
    process.env.DB_PASSWORD || 'your_local_db_password',
    {
      host: process.env.DB_HOST || 'localhost',
      dialect: process.env.DB_DIALECT || 'postgres', 
      pool: {
        max: 20,
        min: 5,
        acquire: 30000,
        idle: 10000
      },
    // Enable logging for debugging in development
    }
  );
}

// Test the connection
(async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
})();


const allowedOrigins = [
  process.env.LOCAL_FRONTEND,
  process.env.LIVE_FRONTEND1,
  process.env.LIVE_FRONTEND2 // Add your new domain here
].filter(Boolean);






const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like curl, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`❌ Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
// app.options('*', cors(corsOptions)); // Enable preflight for all routes
app.use(express.json());



app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

 
//Shareholder Model
const Shareholder = sequelize.define('Shareholder', {

  acno: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone_number: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: false,
  
  },
  holdings: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,

  },
 
  address: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  chn: {
    type: DataTypes.STRING,
    allowNull: true
  },
  rin: {
    type: DataTypes.STRING,
    allowNull: true
  },

}, {
  tableName: 'shareholders',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  freezeTableName: true
});


// Registered User Model
const RegisteredUser = sequelize.define('registeredusers', {

  name: DataTypes.STRING,
  acno: DataTypes.STRING,
  holdings: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0 // Add this
  },
  chn: { type:Sequelize.STRING, allowNull: true },
  email: DataTypes.STRING,
  phone_number: DataTypes.STRING,
  registered_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  sessionId: DataTypes.STRING, 
  
});


  


 const RegisteredHolders = sequelize.define('RegisteredHolders', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone_number: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  
  },
  shareholding: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },

  acno: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  chn: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'suspended'),
    defaultValue: 'active'
  },
  hasVoted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'suspended'),
    defaultValue: 'active'
  },
  registeredAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'registered_at'
  }
}, {
  tableName: 'registeredholders',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  hooks: {
    afterCreate: async (holder, options) => {
      await syncHolderToUser(holder);
    },
    afterUpdate: async (holder, options) => {
      await syncHolderToUser(holder);
    }
  }
});

// Helper function to sync data
async function syncHolderToUser(holder) {
  try {
    const userData = {
      name: holder.name,
      acno: holder.acno,
      holdings: holder.shareholding,
      chn: holder.chn,
      email: holder.email,
      phone_number: holder.phone_number,
      registered_at: holder.registeredAt,
      
    };


 // Find or create the user
 const [user, created] = await RegisteredUser.upsert({
  acno: holder.acno,  // Using acno as the unique identifier
  ...userData
}, {
  returning: true
});

console.log(created ? 'Created new user' : 'Updated existing user', user.acno);
} catch (error) {
console.error('Error syncing holder to user:', error);
}
}




async function migrateExistingHolders() {
  const holders = await RegisteredHolders.findAll();
  for (const holder of holders) {
    await syncHolderToUser(holder);
  }
  console.log('Migration completed ss');
}

// Uncomment to run migration
// migrateExistingHolders();



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
sequelize.sync()
// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


const GuestRegistration = sequelize.define('GuestRegistration', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
      notEmpty: true
    }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  userType: {
    type: DataTypes.ENUM('guest', 'regulator', 'press', 'observer'),
    allowNull: false,
    field: 'user_type'
  },

  createdAt: {
    type: DataTypes.DATE,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'updated_at'
  },
  deletedAt: {
    type: DataTypes.DATE,
    field: 'deleted_at'
  }
}, {
  tableName: 'guest_registrations',
  paranoid: true, // Enable soft deletes
  timestamps: true,
  freezeTableName: true,
  // hooks: {
});

// Alias for backward compatibility with older route logic
const RegisteredGuests = GuestRegistration;

// ---------------- Existing Hooks or Other Code ----------------

// hooks: {
  //   beforeCreate: (guest) => {
  //     // Generate registration number (example: GR-2023-0001)
  //     const year = new Date().getFullYear();
  //     return GuestRegistration.max('id').then(maxId => {
  //       const nextId = (maxId || 0) + 1;
  //       guest.registrationNumber = `GR-${year}-${String(nextId).padStart(4, '0')}`;
  //     });
  //   }
  // }


app.post('/api/check-shareholder', async (req, res) => {
  const { searchTerm } = req.body;

  if (!searchTerm || typeof searchTerm !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid search term.' });
  }

  const cleanTerm = searchTerm.trim();

  try {
    // Check for exact account number match first
    if (/^\d+$/.test(cleanTerm)) {
      const shareholder = await Shareholder.findOne({ 
        where: { acno: cleanTerm } 
      });

      if (shareholder) {
        return res.json({
          status: 'account_match',
          shareholder: formatShareholder(shareholder)
        });
      }
    }

    // Check for exact CHN match
    const byChn = await Shareholder.findOne({ 
      where: { 
        chn: { [Op.iLike]: cleanTerm } // Case-insensitive match
      } 
    });

    if (byChn) {
      return res.json({
        status: 'chn_match',
        shareholder: formatShareholder(byChn)
      });
    }

    // Advanced name search for PostgreSQL
    const shareholders = await Shareholder.findAll({
      where: {
        [Op.or]: [
          // Exact match (case-insensitive)
          { name: { [Op.iLike]: cleanTerm } },
          
          // Starts with term
          { name: { [Op.iLike]: `${cleanTerm}%` } },
          
          // Contains term
          { name: { [Op.iLike]: `%${cleanTerm}%` } },
          
          // Split into words and search for each
          ...cleanTerm.split(/\s+/).filter(Boolean).map(word => ({
            name: { [Op.iLike]: `%${word}%` }
          })),
          
          // Phonetic search using PostgreSQL's metaphone
          sequelize.where(
            sequelize.fn('metaphone', sequelize.col('name'), 4),
            sequelize.fn('metaphone', cleanTerm, 4)
          ),
          
          // Trigram similarity for fuzzy matching
          sequelize.where(
            sequelize.fn('similarity', 
              sequelize.fn('lower', sequelize.col('name')),
              cleanTerm.toLowerCase()
            ),
            { [Op.gt]: 0.3 } // Adjust threshold as needed
          )
        ]
      },
      order: [
        // Prioritize better matches first
        [sequelize.literal(`
          CASE 
            WHEN name ILIKE '${cleanTerm}' THEN 0
            WHEN name ILIKE '${cleanTerm}%' THEN 1
            WHEN name ILIKE '%${cleanTerm}%' THEN 2
            ELSE 3 + (1 - similarity(lower(name), '${cleanTerm.toLowerCase()}'))
          END
        `), 'ASC'],
        [sequelize.col('name'), 'ASC'] // Secondary sort by name
      ],
      limit: 10
    });

    if (shareholders.length > 0) {
      return res.json({
        status: 'name_matches',
        shareholders: shareholders.map(formatShareholder)
      });
    }

    return res.json({ 
      status: 'not_found', 
      message: 'No matching shareholders found.' 
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Internal server error.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});




// Helper function to format shareholder data
function formatShareholder(shareholder) {
  return {
    name: shareholder.name,
    acno: shareholder.acno,
    email: shareholder.email,
    phone_number: shareholder.phone_number,
    chn: shareholder.chn,
    // Include other relevant fields
    holdings: shareholder.holdings,
    address: shareholder.address
  };
}
// Send confirmation link via email
app.post('/api/send-confirmation', async (req, res) => {
  const { acno, email, phone_number } = req.body;

  // Phone number formatting and validation functions
  const formatNigerianPhone = (phone) => {
    if (!phone) return null;
    try {
      const phoneString = String(phone).trim();
      let cleaned = phoneString.replace(/\D/g, '');
      
      if (cleaned.startsWith('0')) {
        return `+234${cleaned.substring(1)}`;
      }
      if (cleaned.startsWith('234') && cleaned.length === 13) {
        return `+${cleaned}`;
      }
      return phoneString;
    } catch (error) {
      console.error('Phone formatting error:', error);
      return null;
    }
  };

  const isValidNigerianPhone = (phone) => {
    return phone && /^\+234[789]\d{9}$/.test(String(phone).trim());
  };

  try {
    // Check if already registered
    const alreadyRegistered = await RegisteredHolders.findOne({ where: { acno } });
    if (alreadyRegistered) {
      return res.status(400).json({ 
        message: '❌ This shareholder is already registered',
        details: { acno }
      });
    }

    // Find shareholder
    const shareholder = await Shareholder.findOne({ where: { acno } });
    if (!shareholder) {
      return res.status(404).json({ 
        message: 'Shareholder not found',
        details: { acno }
      });
    }
1
    // Update email if provided and different
    if (email && email !== shareholder.email) {
      await Shareholder.update({ email }, { where: { acno } });
      shareholder.email = email;
    }



 // Update phone number if provided and different
 if (phone_number && phone_number !== shareholder.phone_number) {
  const formattedPhone = formatNigerianPhone(phone_number);
  if (formattedPhone && isValidNigerianPhone(formattedPhone)) {
    await Shareholder.update({ phone_number: formattedPhone }, { where: { acno } });
    shareholder.phone_number = formattedPhone;
  } else {
    return res.status(400).json({
      message: '❌ Invalid phone number format',
      details: { phone_number }
    });
  }
}

 // Update phone number if provided
 let finalPhoneNumber = shareholder.phone_number;
 if (phone_number) {
   const formattedPhone = formatNigerianPhone(phone_number);
   if (formattedPhone && isValidNigerianPhone(formattedPhone)) {
     await Shareholder.update({ phone_number: formattedPhone }, { where: { acno } });
     finalPhoneNumber = formattedPhone;
   } else {
     return res.status(400).json({
       message: '❌ Invalid phone number format',
       details: { phone_number }
     });
   }
 }

 // Ensure we have at least one contact method
 if (!shareholder.email && !email && !finalPhoneNumber) {
   return res.status(400).json({
     message: '❌ Either email or phone number is required',
     details: { acno }
   });
 }

    
    // Generate verification token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry

    await VerificationToken.create({ 
      acno, 
      token, 
      email: email || shareholder.email, 
      phone_number: finalPhoneNumber,
      expires_at: expiresAt 
    });


    const confirmUrl = `https://e-voting-backeknd-production-077c.up.railway.app/api/confirm/${token}`;

    // Send confirmation email
    await transporter.sendMail({
      from: 'E-Registration <noreply@agm-registration.apel.com.ng>',
      to: shareholder.email,
      subject: 'Confirm Your Registration',
      html: `
        <h2>🗳️ E-Voting Registration</h2>
        <p>Hello ${shareholder.name},</p>
        <p>Click the button below to confirm your registration:</p>
        <a href="${confirmUrl}" style="background-color:#1075bf;padding:12px 20px;color:#fff;text-decoration:none;border-radius:5px;">
          ✅ Confirm Registration
        </a>
        <p>If you didn't request this, please ignore this email.</p>
        <p><small>Token expires at: ${expiresAt.toLocaleString()}</small></p>
      `
    });

    // Send SMS if phone number exists
    if (shareholder.phone_number) {
      try {
        const formattedPhone = formatNigerianPhone(shareholder.phone_number);
        
        if (formattedPhone && isValidNigerianPhone(formattedPhone)) {
          await twilioClient.messages.create({
            body: `Hello ${shareholder.name}, confirm INTERNATIONAL BREWERIES PLC AGM registration: ${confirmUrl}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
          });
          console.log(`SMS sent to ${formattedPhone}`);
        } else {
          console.warn('Invalid phone number format:', shareholder.phone_number);
        }
      } catch (smsError) {
        console.error('SMS sending failed:', {
          error: smsError.message,
          phone: shareholder.phone_number,
          timestamp: new Date().toISOString()
        });
      }
    }

    res.json({ 
      success: true,
      message: '✅ Confirmation sent to your email',
      details: {
        email: shareholder.email,
        phone_number: shareholder.phone_number ? 'SMS sent' : 'No phone number'
      }
    });

  } catch (error) {
    console.error('Send confirmation error:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      requestBody: req.body
    });
    res.status(500).json({ 
      success: false,
      error: 'Failed to send confirmation',
      details: error.message 
    });
  }
});

// Confirm registration
app.get('/api/confirm/:token', async (req, res) => {
  const { token } = req.params;

  // Keep phone functions but don't send SMS
  const formatNigerianPhone = (phone) => {
    if (!phone) return null;
    try {
      const phoneString = String(phone).trim();
      let cleaned = phoneString.replace(/\D/g, '');
      
      if (cleaned.startsWith('0')) {
        return `+234${cleaned.substring(1)}`;
      }
      if (cleaned.startsWith('234') && cleaned.length === 13) {
        return `+${cleaned}`;
      }
      return phoneString;
    } catch (error) {
      console.error('Phone formatting error:', error);
      return null;
    }
  };

  const isValidNigerianPhone = (phone) => {
    return phone && /^\+234[789]\d{9}$/.test(String(phone).trim());
  };

  try {
    // Verify token
    const pending = await VerificationToken.findOne({ where: { token } });
    if (!pending || new Date(pending.expires_at) < new Date()) {
      return res.status(400).send(`
        <h1>❌ Invalid or Expired Token</h1>
        <p>The confirmation link has expired or is invalid.</p>
        <p>Please request a new confirmation email.</p>
      `);
    }

    // Get shareholder data
    const shareholder = await Shareholder.findOne({ where: { acno: pending.acno } });
    if (!shareholder) {
      return res.status(404).send(`
        <h1>❌ Shareholder Not Found</h1>
        <p>We couldn't find your shareholder record.</p>
        <p>Please contact support with your ACNO: ${pending.acno}</p>
      `);
    }

    // Complete registration
    await RegisteredHolders.create({
      name: shareholder.name,
      acno: shareholder.acno,
      email: shareholder.email,
      phone_number: shareholder.phone_number || pending.phone_number, 
      registered_at: new Date(),
      shareholding: shareholder.holdings,
      chn: shareholder.chn,
      rin: shareholder.rin,
      address: shareholder.address
    });

    

    await pending.destroy();

    // Send success email
    await transporter.sendMail({
      from: '"E-Voting Portal" <noreply@agm-registration.apel.com.ng>',
      to: shareholder.email,
      subject: '✅ Registration Complete - INTERNATIONAL BREWERIES PLC AGM',
      html: `
        <h2>🎉 Hello ${shareholder.name},</h2>
        <p>Your registration for the INTERNATIONAL BREWERIES PLC Annual General Meeting is complete.</p>
        <p><strong>ACNO:</strong> ${shareholder.acno}</p>
        <p><strong>Registered Email:</strong> ${shareholder.email}</p>
        <h3>Next Steps:</h3>
        <ul>
          <li>You will receive Zoom meeting details 24 hours before the AGM</li>
          <li>Login using your registered email: <strong>${shareholder.email}</strong></li>
        </ul>
        <p>Thank you for participating!</p>
      `
    });

    // Check if SMS would have been sent (but don't actually send)
    let smsEligible = false;
    if (shareholder.phone_number) {
      const formattedPhone = formatNigerianPhone(shareholder.phone_number);
      smsEligible = formattedPhone && isValidNigerianPhone(formattedPhone);
      
      // Log instead of sending
      if (smsEligible) {
        console.log(`[SMS Simulation] Would have sent to: ${formattedPhone}`);
      }
    }

    // Custom success page with details
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Registration Successful</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 2rem; }
          .success { color: #2ecc71; font-size: 2rem; }
          .details { background: #f8f9fa; padding: 1rem; border-radius: 5px; max-width: 600px; margin: 1rem auto; }
        </style>
      </head>
      <body>
        <div class="success">✅ Registration Successful</div>
        <div class="details">
          <h2>Hello ${shareholder.name}</h2>
          <p>Your registration for the INTERNATIONAL BREWERIES PLC AGM is complete.</p>
          <p><strong>ACNO:</strong> ${shareholder.acno}</p>
          <p><strong>Email:</strong> ${shareholder.email}</p>
          ${smsEligible ? `<p class="sms-notice">📱 SMS notifications are currently disabled</p>` : ''}
          <p>You will receive meeting details via email before the event.</p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Confirmation error:', {
      error: error.message,
      stack: error.stack,
      token,
      timestamp: new Date().toISOString()
    });
    res.status(500).send(`
      <h1>⚠️ Server Error</h1>
      <p>We encountered an error processing your registration.</p>
      <p>Please try again later or contact support.</p>
    `);
  }
});
// Get all registered users with pagination
app.get('/api/registered-users', async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const pageSize = parseInt(req.query.pageSize) || 10; // Default to 10 items per page
    const offset = (page - 1) * pageSize;

    // Sorting parameters
    let sortBy = req.query.sortBy || 'registered_at'; // Default sort by registration date
    if (sortBy === 'createdAt') sortBy = 'registered_at';
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
    const totalCount = await RegisteredHolders.count({ where: whereConditions });

    // Get the paginated results
    const users = await RegisteredHolders.findAll({
      where: whereConditions,
      order: [[sortBy, sortOrder]],
      limit: pageSize,
      offset: offset,
      attributes: ['name', 'acno', 'email', 'phone_number', 'shareholding','chn', 'registered_at'] // Select specific fields
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

// app.get('/api/registered-users', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const pageSize = parseInt(req.query.pageSize) || 10;
//     const offset = (page - 1) * pageSize;
//     let sortBy = req.query.sortBy || (req.query.userType === 'guests' ? 'createdAt' : 'registered_at');
//     const sortOrder = req.query.sortOrder || 'DESC';
//     const searchTerm = req.query.search || '';
//     const userType = req.query.userType || 'shareholders';

//     const model = userType === 'shareholders' ? RegisteredHolders : GuestRegistration;
    
//     // Map sortBy to correct column names
//     if (userType === 'shareholders') {
//       if (sortBy === 'createdAt') sortBy = 'registered_at';
//       if (sortBy === 'phone') sortBy = 'phone_number';
//     }

//     const whereConditions = {};
//     if (searchTerm) {
//       whereConditions[Op.or] = userType === 'shareholders' 
//         ? [
//             { name: { [Op.iLike]: `%${searchTerm}%` } },
//             { acno: { [Op.iLike]: `%${searchTerm}%` } },
//             { email: { [Op.iLike]: `%${searchTerm}%` } },
//             { phone_number: { [Op.iLike]: `%${searchTerm}%` } },
//             { chn: { [Op.iLike]: `%${searchTerm}%` } }
//           ]
//         : [
//             { name: { [Op.iLike]: `%${searchTerm}%` } },
//             { email: { [Op.iLike]: `%${searchTerm}%` } },
//             { phone: { [Op.iLike]: `%${searchTerm}%` } },
//             { registrationNumber: { [Op.iLike]: `%${searchTerm}%` } },
//             { userType: { [Op.iLike]: `%${searchTerm}%` } }
//           ];
//     }

//     const totalCount = await model.count({ where: whereConditions });
//     const results = await model.findAll({
//       where: whereConditions,
//       order: [[sortBy, sortOrder]],
//       limit: pageSize,
//       offset: offset,
//       attributes: userType === 'shareholders'
//         ? ['name', 'acno', 'email', 'phone_number', 'shareholding', 'chn', 'registered_at']
//         : ['name', 'email', 'phone', 'userType', 'registrationNumber', 'createdAt']
//     });

//     res.json({
//       success: true,
//       data: results,
//       pagination: {
//         totalItems: totalCount,
//         totalPages: Math.ceil(totalCount / pageSize),
//         currentPage: page,
//         pageSize: pageSize
//       }
//     });

//   } catch (error) {
//     console.error('Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Database error',
//       error: error.message
//     });
//   }
// });


app.post('/api/register-guest', (req, res) => {
  const { name, email, phone, userType } = req.body;
  
  // Basic validation
  if (!name || !email || !phone || !userType) {
    return res.status(400).json({ success: false, error: 'All fields are required' });
  }
  
  // Add to in-memory storage
  const newGuest = {
    name,
    email,
    phone,
    userType,
    registeredAt: new Date().toISOString()
  };
  
  GuestRegistration.create(newGuest);
  
  res.status(201).json({
    success: true,
    guest: newGuest
  });
});
app.get('/api/registered-guests', async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // Sorting parameters - use 'created_at' instead of 'createdAt'
    const sortBy = req.query.sortBy || 'created_at'; // Changed to match your actual column name
    const sortOrder = req.query.sortOrder || 'DESC';

    // Search filter
    const searchTerm = req.query.search || '';

    // Build the query conditions
    const whereConditions = {};
    if (searchTerm) {
      whereConditions[Op.or] = [
        { name: { [Op.like]: `%${searchTerm}%` } },
        { email: { [Op.like]: `%${searchTerm}%` } },
        { phone: { [Op.like]: `%${searchTerm}%` } },
        { userType: { [Op.like]: `%${searchTerm}%` } }
      ];
    }

    // Get the total count for pagination info
    const totalCount = await RegisteredGuests.count({ where: whereConditions });

    // Get the paginated results
    const guests = await RegisteredGuests.findAll({
      where: whereConditions,
      order: [[sortBy, sortOrder]],
      limit: pageSize,
      offset: offset,
      attributes: ['name', 'email', 'phone', 'userType', 'created_at'] // Make sure this matches your column name
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({
      success: true,
      data: guests,
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
    console.error('Error fetching registered guests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch registered guests',
      error: error.message
    });
  }
});
// Start server
const PORT = process.env.PORT;
sequelize.sync().then(() => {
  console.log('✅ Database synced');
  app.listen(PORT, () => {
    console.log(`🚀 Server running on ${PORT}`);
  });
});
