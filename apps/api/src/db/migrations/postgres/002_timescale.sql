SELECT create_hypertable('vital_readings', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);
