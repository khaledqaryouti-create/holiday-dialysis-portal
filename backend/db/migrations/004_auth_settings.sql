-- 004_auth_settings.sql — Admin Settings → Sign-in & Directory.
-- Three sign-in methods that can run side by side: Microsoft (Entra ID, OpenID Connect), directory user name + password
-- (LDAP / Active Directory) and local portal passwords. Secrets are encrypted with pgcrypto (FIELD_ENCRYPTION_KEY).

CREATE TABLE auth_settings (
  id                         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- local passwords
  local_enabled              boolean NOT NULL DEFAULT false,
  password_min_length        integer NOT NULL DEFAULT 10 CHECK (password_min_length BETWEEN 8 AND 64),
  password_require_upper     boolean NOT NULL DEFAULT true,
  password_require_lower     boolean NOT NULL DEFAULT true,
  password_require_digit     boolean NOT NULL DEFAULT true,
  password_require_symbol    boolean NOT NULL DEFAULT false,
  -- applies to every user-name + password sign-in (local and directory)
  lockout_threshold          integer NOT NULL DEFAULT 5 CHECK (lockout_threshold BETWEEN 3 AND 20),
  lockout_minutes            integer NOT NULL DEFAULT 15 CHECK (lockout_minutes BETWEEN 1 AND 1440),
  -- directory (LDAP / Active Directory)
  ldap_enabled               boolean NOT NULL DEFAULT false,
  ldap_host                  text,
  ldap_port                  integer CHECK (ldap_port IS NULL OR ldap_port BETWEEN 1 AND 65535),
  ldap_security              text NOT NULL DEFAULT 'ldaps' CHECK (ldap_security IN ('ldaps','starttls','none')),
  ldap_bind_dn               text,
  ldap_bind_password_enc     bytea,
  ldap_base_dn               text,
  ldap_user_filter           text NOT NULL DEFAULT '(&(objectClass=user)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))',
  ldap_email_attr            text NOT NULL DEFAULT 'mail',
  ldap_name_attr             text NOT NULL DEFAULT 'displayName',
  ldap_group_attr            text NOT NULL DEFAULT 'memberOf',
  ldap_username_hint         text,
  ldap_allow_self_signed     boolean NOT NULL DEFAULT false,
  ldap_timeout_seconds       integer NOT NULL DEFAULT 10 CHECK (ldap_timeout_seconds BETWEEN 3 AND 60),
  ldap_last_test             jsonb,
  -- Microsoft (Entra ID)
  ms_enabled                 boolean NOT NULL DEFAULT false,
  ms_tenant_id               text,
  ms_client_id               text,
  ms_client_secret_enc       bytea,
  ms_redirect_uri            text,
  ms_button_label            text NOT NULL DEFAULT 'Sign in with Microsoft',
  ms_last_test               jsonb,
  -- provisioning
  auto_create_users          boolean NOT NULL DEFAULT false,
  sync_roles_from_groups     boolean NOT NULL DEFAULT false,
  updated_by_user_id         uuid REFERENCES portal_user(id),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ldap_enabled_complete CHECK (NOT ldap_enabled OR (ldap_host IS NOT NULL AND ldap_port IS NOT NULL AND ldap_base_dn IS NOT NULL)),
  CONSTRAINT ms_enabled_complete CHECK (NOT ms_enabled OR (ms_tenant_id IS NOT NULL AND ms_client_id IS NOT NULL AND ms_client_secret_enc IS NOT NULL AND ms_redirect_uri IS NOT NULL))
);
INSERT INTO auth_settings (id) VALUES (1);
ALTER TABLE auth_settings ENABLE ROW LEVEL SECURITY;

-- Directory / Microsoft group → portal role (and optionally clinic). Used for auto-creating users and syncing roles.
CREATE TABLE auth_group_mapping (
  id                  bigserial PRIMARY KEY,
  source              text NOT NULL CHECK (source IN ('ldap','microsoft')),
  group_identifier    text NOT NULL,          -- LDAP: group DN or CN; Microsoft: group object ID
  group_label         text,
  role_code           text NOT NULL REFERENCES role(role_code),
  facility_id         uuid REFERENCES facility(id),
  created_by_user_id  uuid REFERENCES portal_user(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_group_mapping_uq ON auth_group_mapping
  (source, lower(group_identifier), role_code, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE auth_group_mapping ENABLE ROW LEVEL SECURITY;

-- Local passwords and sign-in details on the user.
ALTER TABLE portal_user ADD COLUMN IF NOT EXISTS password_hash text; -- existing bcrypt hashes stay; new local passwords may be scrypt
ALTER TABLE portal_user ADD COLUMN password_changed_at timestamptz;
ALTER TABLE portal_user ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE portal_user ADD COLUMN ldap_dn text;
ALTER TABLE portal_user ADD COLUMN last_sign_in_method text CHECK (last_sign_in_method IS NULL OR last_sign_in_method IN ('local','ldap','microsoft','dev'));

-- Failed sign-in tracking (keyed by the lower-cased user name typed, so it also covers names that don't exist).
CREATE TABLE auth_failure (
  username_key     text PRIMARY KEY,
  failed_count     integer NOT NULL DEFAULT 0,
  last_failed_at   timestamptz,
  locked_until     timestamptz
);
ALTER TABLE auth_failure ENABLE ROW LEVEL SECURITY;
