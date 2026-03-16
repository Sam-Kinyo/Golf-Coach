-- 高爾夫預約系統 — PostgreSQL Schema
-- 執行前請建立資料庫與擴展

-- 擴展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 枚舉類型
CREATE TYPE user_role AS ENUM ('student', 'coach');
CREATE TYPE package_status AS ENUM ('active', 'expired', 'fully_used', 'cancelled');
CREATE TYPE booking_status AS ENUM ('pending', 'approved', 'rejected', 'completed', 'cancelled');
CREATE TYPE credit_reason AS ENUM ('purchase', 'lesson_attended', 'refund', 'manual_adjustment');
CREATE TYPE waitlist_status AS ENUM ('waiting', 'notified', 'expired', 'cancelled');

-- 1. users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_user_id VARCHAR(64) UNIQUE NOT NULL,
  role user_role NOT NULL DEFAULT 'student',
  alias VARCHAR(64),
  display_name VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_line_user_id ON users(line_user_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_alias ON users(alias) WHERE alias IS NOT NULL;

-- 2. coach_whitelist
CREATE TABLE coach_whitelist (
  line_user_id VARCHAR(64) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. packages
CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_credits INT NOT NULL CHECK (total_credits > 0),
  used_credits INT NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  remaining_credits INT NOT NULL CHECK (remaining_credits >= 0),
  valid_from DATE,
  valid_to DATE,
  status package_status NOT NULL DEFAULT 'active',
  title VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_packages_user_id ON packages(user_id);
CREATE INDEX idx_packages_status ON packages(status);
CREATE INDEX idx_packages_valid_to ON packages(valid_to);

-- 4. credit_transactions
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES packages(id),
  user_id UUID NOT NULL REFERENCES users(id),
  change INT NOT NULL,
  reason credit_reason NOT NULL,
  booking_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_tx_package ON credit_transactions(package_id);
CREATE INDEX idx_credit_tx_user ON credit_transactions(user_id);
CREATE INDEX idx_credit_tx_created ON credit_transactions(created_at);

-- 5. coach_leaves
CREATE TABLE coach_leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leave_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_leaves_date ON coach_leaves(leave_date);

-- 6. bookings (需在 credit_transactions 之後，因 booking_id 可為 FK)
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location VARCHAR(128),
  service VARCHAR(64),
  status booking_status NOT NULL DEFAULT 'pending',
  package_id UUID REFERENCES packages(id),
  credits_used INT NOT NULL DEFAULT 0,
  calendar_event_id VARCHAR(256),
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_date_status ON bookings(booking_date, status);
CREATE UNIQUE INDEX idx_bookings_slot ON bookings(booking_date, start_time) WHERE status IN ('pending', 'approved');

ALTER TABLE credit_transactions ADD CONSTRAINT fk_booking
  FOREIGN KEY (booking_id) REFERENCES bookings(id);

-- 7. waitlists
CREATE TABLE waitlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  desired_date DATE NOT NULL,
  start_time TIME NOT NULL,
  location VARCHAR(128),
  service VARCHAR(64),
  status waitlist_status NOT NULL DEFAULT 'waiting',
  notified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_waitlists_date_time ON waitlists(desired_date, start_time);
CREATE INDEX idx_waitlists_status ON waitlists(status);

-- 8. notifications_log
CREATE TABLE notifications_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(32) NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user_type ON notifications_log(user_id, type);

-- 更新 updated_at 的 trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
CREATE TRIGGER packages_updated_at BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
