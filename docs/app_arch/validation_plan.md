# Comprehensive Input Validation Plan

## 1. Overview
This document outlines the validation rules, input constraints, and upload limits for all user-facing forms within the application, ensuring robust data integrity and a smooth user experience. This applies to the **Signup Form**, **Driver Registration Form**, and **Restaurant Registration Form**.

## 2. General Validation Rules (All Forms)
- **Names (First Name, Last Name, Full Name, Restaurant Name):**
  - Must contain only alphabetical characters and spaces. Numbers and special characters are not allowed.
  - Cannot be empty (required field).
- **Password Strength:**
  - The UI must feature a dynamic real-time password strength indicator.
  - **Minimum Requirement:** Passwords must meet at least a **"Medium"** strength threshold (e.g., minimum 8 characters, containing a mix of letters and numbers).
- **Email/Phone (Standard):**
  - Emails must match a valid regex format.
  - Phone numbers must be numeric and meet local length requirements.
  - **Country Code:** Include a dropdown menu for the country code, defaulting to Egypt's code (e.g., `+20`).

## 3. Driver Registration Form Specifics
The driver application involves specific rules for registering their vehicle:

### 3.1 Vehicle Type Selection
- **Vehicle Category:** Radio buttons or toggle between "Car", "Motorcycle", and "Cycle".

### 3.2 Vehicle Brand / Model Dropdowns
- **If "Car" is selected:**
  - Display a dropdown menu populated with standard car types/brands (e.g., Sedan, SUV, Hyundai, Toyota).
  - The dropdown must include an **"Other"** option.
  - **Conditional Input:** If "Other" is selected, a new standard text input field must appear, allowing the user to manually type their car type.
- **If "Motorcycle" is selected:**
  - Display a dropdown menu populated with standard motorcycle types/brands (e.g., Scooter, Sport, standard brands).
- **If "Cycle" is selected:**
  - Display a dropdown menu for cycle types: **"Normal Cycle"** and **"Electronic Cycle"**.

### 3.3 Vehicle Color
- **Color Selector:** A dropdown menu or visual color palette selector allowing the driver to pick the exact color of their vehicle. This applies to all vehicle types (Car, Motorcycle, and Cycle).

### 3.4 License Plate Details
*Note: License plate details are **only required for Cars and Motorcycles**. If "Cycle" is selected, this section must be hidden as cycles do not have license plates.*

To prevent user error and formatting issues, the license plate input will be strictly controlled using granular input fields:
- **Letters (Characters):**
  - Create 4 distinct input fields.
  - Each field accepts **exactly 1 alphabetical character**.
- **Numbers (Digits):**
  - Create 4 distinct input fields.
  - Each field accepts **exactly 1 numeric digit (0-9)**.
- *Note: Focus should automatically shift to the next box once a character is entered.*

## 4. Restaurant Registration Form Specifics
The restaurant application requires specific financial details to facilitate payouts.

### 4.1 Bank Information
- **Bank Name:** Must contain only alphabetical characters and spaces (e.g., "Banque Misr", "CIB").
- **Account Holder Name:** Must strictly follow the general Name validation (only alphabetical characters and spaces) and match the legal name.
- **IBAN:**
  - Must begin with a valid country prefix (e.g., "EG" for Egypt).
  - Must fall within standard IBAN length requirements (15 to 34 characters).
  - Must contain only alphanumeric characters.
  - *Formatting UX:* Automatically insert spaces every 4 characters for readability, but strip them before submission.

## 5. File Upload Constraints (Images & Documents)
To optimize server storage and prevent abuse, strict limits must be applied to all media uploads (Profile Pictures, ID Cards, Driver Licenses, Restaurant Menus, etc.):

- **Maximum File Size:** **10 MB limit** per file.
- **UI Feedback:** If a user selects a file larger than 10MB, the file picker should immediately reject it with an error toast/message stating: *"File exceeds the 10MB limit."*
- **Upload Method Constraint:** The actual network upload method (e.g., API multipart request) must mathematically verify the file byte size `(sizeInBytes <= 10485760)` before initiating the upload stream.
- **Backend Enforcement:** The backend server must be configured to reject incoming payloads larger than 10MB.
- **Allowed Types:**
  - Images: `.jpg`, `.jpeg`, `.png`
  - Documents: `.pdf`

## 5. Development Action Items
1. **Frontend (Flutter):**
   - Implement `TextFormField` validation using Regex for names.
   - Integrate a password strength library (e.g., `password_strength` or `zxcvbn`).
   - Build a custom input widget for the 8-box License Plate input.
   - Wrap the file picking logic to inspect file size before hitting the upload API.
2. **Backend:**
   - Ensure the server router/multer file size limit limit is set strictly to `10MB`.
