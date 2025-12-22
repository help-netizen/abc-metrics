import os
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection
DB_URL = os.getenv('DATABASE_URL')

# Google Sheets Configuration
SHEET_NAME = os.getenv('GOOGLE_SHEETS_NAME', 'ABC Business Data')
# Service Account JSON path or env var
GOOGLE_CREDS_PATH = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', 'credentials.json')

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def get_db_connection():
    return psycopg2.connect(DB_URL)

def sync_tab_to_postgres(tab_name, table_name, schema='public'):
    """Syncs a single tab from Google Sheets to a Postgres table."""
    print(f"Syncing {tab_name} to {table_name}...")
    
    # Authenticate with Google
    creds = Credentials.from_service_account_file(GOOGLE_CREDS_PATH, scopes=SCOPES)
    gc = gspread.authorize(creds)
    
    # Open spreadsheet and get values
    sh = gc.open(SHEET_NAME)
    worksheet = sh.worksheet(tab_name)
    data = worksheet.get_all_records()
    
    if not data:
        print(f"No data found in tab {tab_name}")
        return

    df = pd.DataFrame(data)
    
    # Basic cleaning
    df.columns = [c.lower().replace(' ', '_') for c in df.columns]
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Create columns if they don't exist (basic auto-migration)
        # For production, it's better to have fixed schema in migrations
        cols = ", ".join([f"{col} TEXT" for col in df.columns])
        cur.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({cols}, created_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
        
        # Prepare for upsert or full replace
        # For simplicity in v1, we'll do a full replace within a transaction
        cur.execute(f"TRUNCATE TABLE {table_name}")
        
        columns = df.columns.tolist()
        values = [tuple(x) for x in df.values]
        
        insert_query = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES %s"
        execute_values(cur, insert_query, values)
        
        conn.commit()
        print(f"Successfully synced {len(df)} rows to {table_name}")
        
    except Exception as e:
        conn.rollback()
        print(f"Error syncing {tab_name}: {e}")
        raise e
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    # Example usage for identified tabs
    tabs_to_sync = {
        'Parts': 'raw_sheets_parts',
        'Expenses': 'raw_sheets_expenses',
        'Marketing': 'raw_sheets_marketing'
    }
    
    for tab, table in tabs_to_sync.items():
        try:
            sync_tab_to_postgres(tab, table)
        except Exception as e:
            print(f"Failed to sync {tab}: {e}")
