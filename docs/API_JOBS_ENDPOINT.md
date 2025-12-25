# API Documentation: Jobs Endpoint

## POST /api/db/jobs

Create or update a job record in the `fact_jobs` table.

### Endpoint
```
POST /api/db/jobs
```

### Authentication
Requires API key in header:
```
Authorization: Bearer YOUR_API_KEY
```

### Request Body

All fields are optional except `job_id`. The endpoint uses `ON CONFLICT (job_id) DO UPDATE` to handle both creation and updates.

#### Required Fields
| Field | Type | Description |
|-------|------|-------------|
| `job_id` | string | Unique job identifier (UUID) |

#### Core Job Information
| Field | Type | Description |
|-------|------|-------------|
| `lead_id` | string | Reference to associated lead |
| `created_at` | timestamp | Job creation date/time |
| `scheduled_at` | timestamp | Job scheduled date/time |
| `source_id` | integer | Reference to `dim_source` table |
| `type` | string | Job type (e.g., "COD Service", "INS Repair") |
| `client_id` | string | Client identifier |

#### Job Metrics
| Field | Type | Description |
|-------|------|-------------|
| `serial_id` | integer | Serial/job number from Workiz |
| `job_total_price` | numeric(10,2) | Total job price |
| `job_amount_due` | numeric(10,2) | Amount due |
| `sub_total` | numeric(10,2) | Subtotal before tax |
| `item_cost` | numeric(10,2) | Cost of parts/items |
| `tech_cost` | numeric(10,2) | Technician labor cost |

#### Contact Information
| Field | Type | Description |
|-------|------|-------------|
| `phone` | string | Primary phone (normalized to 10 digits) |
| `second_phone` | string | Secondary phone (normalized to 10 digits) |
| `phone_ext` | string | Primary phone extension |
| `second_phone_ext` | string | Secondary phone extension |
| `email` | string | Email address |
| `first_name` | string | Client first name |
| `last_name` | string | Client last name |
| `company` | string | Company name |

#### Address Information
| Field | Type | Description |
|-------|------|-------------|
| `address` | string | Street address |
| `city` | string | City |
| `state` | string | State (2-letter code) |
| `postal_code` | string | ZIP/postal code (normalized to 5 digits) |
| `country` | string | Country code (e.g., "US") |
| `latitude` | string | Geographic latitude |
| `longitude` | string | Geographic longitude |

#### Job Details
| Field | Type | Description |
|-------|------|-------------|
| `technician_name` | string | Assigned technician name |
| `sub_status` | string | Job sub-status |
| `job_end_date_time` | timestamp | Job completion date/time |
| `last_status_update` | timestamp | Last status change date/time |
| `payment_due_date` | timestamp | Payment due date |
| `job_notes` | string | Job notes/instructions |
| `comments` | string | Additional comments |
| `timezone` | string | Timezone (e.g., "US/Pacific") |
| `referral_company` | string | Referral source company |
| `service_area` | string | Service area/zone |
| `created_by` | string | User who created the job |
| `tags` | jsonb | Array of tags |
| `team` | jsonb | Array of team members |

#### Metadata
| Field | Type | Description |
|-------|------|-------------|
| `meta` | jsonb | Complete raw data from source system |

### Example Request

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "serial_id": 12345,
  "created_at": "2025-12-23T10:00:00Z",
  "scheduled_at": "2025-12-23T14:00:00Z",
  "source_id": 1,
  "type": "COD Service",
  "client_id": "1002",
  
  "phone": "(619) 555-1234",
  "email": "client@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "company": "Acme Inc",
  
  "address": "123 Main Street",
  "city": "San Diego",
  "state": "CA",
  "postal_code": "92109",
  "country": "US",
  "latitude": "32.7157",
  "longitude": "-117.1611",
  
  "technician_name": "Tom Smith",
  "job_total_price": 350.00,
  "job_amount_due": 350.00,
  "sub_total": 320.00,
  "item_cost": 150.00,
  "tech_cost": 100.00,
  
  "sub_status": "Scheduled",
  "job_end_date_time": "2025-12-23T16:30:00Z",
  "payment_due_date": "2025-12-30T00:00:00Z",
  "job_notes": "Please call before arrival",
  "timezone": "US/Pacific",
  "service_area": "North County",
  "created_by": "admin@company.com",
  
  "tags": ["urgent", "warranty"],
  "team": [
    {"id": "123", "name": "Tom Smith"}
  ],
  
  "meta": {
    "JobSource": "Google",
    "ReferralCompany": "Thumbtack"
  }
}
```

### Response

#### Success (200 OK)
```json
{
  "success": true,
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Job created/updated successfully"
}
```

#### Error (400 Bad Request)
```json
{
  "error": "Invalid request",
  "message": "job_id is required"
}
```

#### Error (401 Unauthorized)
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

### Data Normalization

The following fields are automatically normalized:

- **phone**, **second_phone**: Normalized to 10-digit US format (removes non-digits, strips leading '1' if 11 digits)
- **postal_code**: Normalized to 5-digit ZIP code format
- **meta**: Phone numbers within nested JSON are recursively normalized

### Notes

1. **Idempotent**: Multiple calls with the same `job_id` will update the existing record
2. **Partial Updates**: You can send only the fields you want to update (except `job_id` which is always required)
3. **Timestamps**: All timestamp fields accept ISO 8601 format
4. **JSONB Fields**: `tags`, `team`, and `meta` accept any valid JSON structure
5. **Auto-timestamps**: `created_at_db` and `updated_at_db` are automatically managed by the database

### Related Endpoints

- `GET /api/table/fact_jobs` - View all jobs
- `GET /api/table/fact_jobs/csv` - Export jobs to CSV
- `POST /api/sync/workiz/jobs` - Sync jobs from Workiz API
