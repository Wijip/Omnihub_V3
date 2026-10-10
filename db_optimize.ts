import mysql from 'mysql2/promise';
import 'dotenv/config';

const optimizeDatabase = async () => {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || 'B3lpasshooter1004.';
  const database = process.env.DB_NAME || 'omnihub_reporting';

  console.log('[OPTIMIZATION] Connecting to MySQL Database...');
  const connection = await mysql.createConnection({ host, user, password, database });

  const indexQueries = [
    "ALTER TABLE systemlogs ADD INDEX idx_created_at (created_at)",
    "ALTER TABLE systemlogs ADD INDEX idx_level (level)",
    "ALTER TABLE videoresolutions ADD INDEX idx_status (status)",
    "ALTER TABLE video_analytics ADD INDEX idx_video_id (video_id)",
    "ALTER TABLE video_analytics ADD INDEX idx_created_at (created_at)",
    "ALTER TABLE views ADD INDEX idx_video_id (video_id)",
    "ALTER TABLE views ADD INDEX idx_created_at (created_at)"
  ];

  for (const query of indexQueries) {
    try {
      console.log(`[OPTIMIZATION] Executing: ${query}`);
      await connection.query(query);
      console.log(`[OPTIMIZATION] Success.`);
    } catch (error: any) {
      if (error.code === 'ER_DUP_KEYNAME') {
        console.log(`[OPTIMIZATION] Skipped: Index already exists.`);
      } else {
        console.error(`[OPTIMIZATION] Error: ${error.message}`);
      }
    }
  }

  console.log('[OPTIMIZATION] Database Indexing Complete.');
  await connection.end();
};

optimizeDatabase().catch(console.error);
