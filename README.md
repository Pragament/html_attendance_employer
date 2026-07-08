# EmpManager – Employee Management for Employers

A single‑page web application that lets employers manage multiple organizations and their employees, with secure Google authentication via Supabase.

---

## About the App

**EmpManager** is a lightweight, self‑contained HTML/JavaScript tool designed for employers who need to:

- **Create and manage organizations** – each with a unique 4‑digit code and a name.
- **Manage employee accounts** – add, edit, or delete employees within any organization.
- **Store employee credentials** – each employee has a unique ID, full name, role (with autocomplete from previously used roles), password, and a 4‑digit PIN (both hashed with bcrypt).
- **Sign in securely** – employers log in with their Google account using Supabase Auth.

All data is stored in your own **Supabase** project, so you have full control and ownership of your data.

---

## Features

- **Employer authentication** – Google OAuth via Supabase.
- **Organization CRUD** – create, read, update, delete organizations with a 4‑digit code.
- **Employee CRUD** – create, read, update, delete employees within each organization.
- **Role autocomplete** – role suggestions based on previously used roles in the organization.
- **Secure password & PIN storage** – hashed with bcrypt before sending to the database.
- **Responsive UI** – works on desktop and mobile devices.

---

## Developer Setup

### 1. Supabase Project

1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. Note your **Project URL** (e.g., `https://xyzcompany.supabase.co`) and **anon public key** – you’ll need them later.

### 2. Database Tables

Execute the following SQL in the Supabase SQL Editor to create the required tables and enable Row Level Security (RLS):

```sql
-- Organizations
CREATE TABLE organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_code TEXT NOT NULL,
  org_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Employees
CREATE TABLE employees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  password_hash TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, employee_id)
);

-- Roles (for autocomplete)
CREATE TABLE roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  UNIQUE(organization_id, role_name)
);

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
```

### 3. Row Level Security (RLS) Policies

Create policies to ensure employers only access their own data:

```sql
-- Organizations
CREATE POLICY "Employers can view their own organizations"
  ON organizations FOR SELECT USING (auth.uid() = employer_id);

CREATE POLICY "Employers can insert their own organizations"
  ON organizations FOR INSERT WITH CHECK (auth.uid() = employer_id);

CREATE POLICY "Employers can update their own organizations"
  ON organizations FOR UPDATE USING (auth.uid() = employer_id);

CREATE POLICY "Employers can delete their own organizations"
  ON organizations FOR DELETE USING (auth.uid() = employer_id);

-- Employees (access through organization ownership)
CREATE POLICY "Employers can manage employees in their organizations"
  ON employees FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = employees.organization_id
        AND organizations.employer_id = auth.uid()
    )
  );

-- Roles (access through organization ownership)
CREATE POLICY "Employers can manage roles in their organizations"
  ON roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = roles.organization_id
        AND organizations.employer_id = auth.uid()
    )
  );
```

### 4. Enable Google OAuth in Supabase

1. In your Supabase dashboard, go to **Authentication** → **Providers**.
2. Enable **Google** and configure your OAuth credentials (obtain from Google Cloud Console).
3. Set the redirect URL to your app’s URL (e.g., `https://yourdomain.com` or `http://localhost:3000`).

### 5. Run the App

The app is a single HTML file – no build tools required.

- **Locally**: open the `index.html` file in a modern browser (Chrome, Edge, Firefox).
- **Hosted**: upload the file to any static hosting service (Netlify, Vercel, GitHub Pages, etc.).

---

## Employer Setup & Usage

### First‑Time Configuration

1. Open the app in your browser.
2. You will see the **Supabase Configuration** page.
3. Enter your **Supabase Project URL** and **anon public key** (both can be found in your Supabase project settings under “API”).
4. Click **Save & Connect** – the configuration is stored in your browser’s local storage.

### Sign In

1. After saving the configuration, you’ll be redirected to the **Login** page.
2. Click **Sign in with Google** – you’ll be asked to choose a Google account.
3. Once authenticated, you’ll see the **Organizations** dashboard.

### Managing Organizations

- **Create** – click the **New Organization** button, enter a unique 4‑digit code and a name, then click **Save**.
- **View employees** – click on any organization card to open its employee list.
- **Edit** – click the **Edit** button on an organization card to modify its code or name.
- **Delete** – click the **Delete** button – this will permanently remove the organization and all its employees.

### Managing Employees (within an Organization)

1. Open an organization by clicking its card.
2. **Add** – click **Add Employee**, fill in:
   - **Employee ID** – unique within this organization.
   - **Full Name**
   - **Role** – start typing to see autocomplete suggestions from existing roles; you can also enter a new role.
   - **Password** – at least 6 characters.
   - **4‑digit PIN** – exactly 4 digits.
3. **Edit** – click the **Edit** button on an employee row – you can update all fields. Leave password/PIN blank to keep them unchanged.
4. **Delete** – click the **Delete** button to remove the employee.

### Logout

Click the **Logout** button in the top bar to sign out.

---

## Security Notes

- All passwords and PINs are hashed using **bcrypt** on the client side before being sent to Supabase.
- Supabase RLS policies ensure that employers can only access their own organizations and associated employees.
- The Supabase configuration is stored in the browser’s `localStorage` – make sure to use a secure connection (HTTPS) in production.

---

## Technologies Used

- **Supabase** – backend as a service (authentication, database, RLS).
- **bcryptjs** – client‑side password hashing.
- **Font Awesome** – icons.
- **Google Fonts** – Inter typeface.
- Pure vanilla JavaScript, HTML5, CSS3 – no external frameworks.

---

## Troubleshooting

- **"Supabase not configured"** – check that you’ve entered the correct URL and anon key.
- **Google login fails** – ensure OAuth is properly set up in Supabase and the redirect URL matches your app’s URL.
- **“Error loading organizations”** – verify RLS policies and that your Supabase tables exist with the correct schema.
- **“Organization code must be 4 digits”** – codes must be numeric and exactly 4 characters.

---

Enjoy managing your workforce with EmpManager! 🚀
