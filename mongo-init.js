db.createUser({
  user: process.env.MONGO_INITDB_ROOT_USERNAME,
  pwd: process.env.MONGO_INITDB_ROOT_PASSWORD,
  roles: [
    {
      role: "readWrite",
      db: "raw-wealthy"
    }
  ]
});

db.createCollection("users");
db.createCollection("investments");
db.createCollection("transactions");
db.createCollection("deposits");
db.createCollection("withdrawals");

// Create indexes for performance
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "referral_code": 1 }, { unique: true });
db.investments.createIndex({ "user": 1, "created_at": -1 });
db.transactions.createIndex({ "user": 1, "created_at": -1 });
db.deposits.createIndex({ "status": 1, "created_at": -1 });
db.withdrawals.createIndex({ "status": 1, "created_at": -1 });
