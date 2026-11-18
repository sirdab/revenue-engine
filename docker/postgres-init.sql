-- Runs once, when the Postgres container first creates its data directory.
-- The app must connect as an ordinary role: superusers and BYPASSRLS roles
-- skip row-level security, which is what keeps workspaces apart.
CREATE ROLE crm_app LOGIN PASSWORD 'crm_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE crm OWNER crm_app;
