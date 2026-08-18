-- Deploy current:002_current_seed to pg
-- requires: 001_incidents_baseline

-- Current's application reference data (incident templates, categories,
-- external link types, age ranges, sub-locations, ban letter templates).
-- Sub-locations attach to the platform demo root by its pinned uuid
-- (5eed0000-...-0201: org units are cross-database references, resolved
-- via the odo org API at runtime); ban letter authorship is stamped with
-- the odo-registration account's pinned uuid.
--
-- Idempotent: keyed on primary keys; re-runs update nothing (DO NOTHING).

BEGIN;

INSERT INTO incidents.categories (code, label, description, icon, display_order, is_active) VALUES
    ($q$behavior$q$, $q$Behavior$q$, $q$Behavioral incidents including disruptions, altercations, and harassment$q$, $q$👥$q$, 2, true),
    ($q$facility$q$, $q$Facility$q$, $q$Facility and equipment issues including malfunctions and damage$q$, $q$🏢$q$, 4, true),
    ($q$general$q$, $q$General$q$, $q$General incidents not covered by other categories$q$, $q$📑$q$, 6, true),
    ($q$medical$q$, $q$Medical$q$, $q$Medical emergencies and health-related incidents$q$, $q$🏥$q$, 3, true),
    ($q$policy$q$, $q$Policy$q$, $q$Policy violations including internet misuse and conduct violations$q$, $q$📋$q$, 5, true),
    ($q$security$q$, $q$Security$q$, $q$Security-related incidents including theft, vandalism, and trespassing$q$, $q$🔒$q$, 1, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO incidents.external_link_type (id, label, description, display_order, is_active) VALUES
    (1, $q$security_video$q$, $q$Security camera footage$q$, 10, true),
    (2, $q$police_report$q$, $q$Police report or case number$q$, 20, true),
    (3, $q$news_article$q$, $q$News coverage or media report$q$, 30, true),
    (4, $q$internal_document$q$, $q$Internal documentation or memo$q$, 40, true),
    (5, $q$photo_album$q$, $q$Collection of photos$q$, 50, true),
    (6, $q$witness_statement$q$, $q$Written witness statement$q$, 60, true),
    (7, $q$medical_report$q$, $q$Medical or first aid report$q$, 70, true),
    (8, $q$other$q$, $q$Other external link$q$, 100, true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('incidents.external_link_type_id_seq', GREATEST((SELECT MAX(id) FROM incidents.external_link_type), 1));

INSERT INTO incidents.patron_age_range (id, label) VALUES
    (1, $q$Unspecified$q$),
    (2, $q$Under 13 years$q$),
    (3, $q$13-17 years$q$),
    (4, $q$18-24 years$q$),
    (5, $q$25-34 years$q$),
    (6, $q$35-44 years$q$),
    (7, $q$45-54 years$q$),
    (8, $q$55+ years$q$)
ON CONFLICT (id) DO NOTHING;
SELECT setval('incidents.patron_age_range_id_seq', GREATEST((SELECT MAX(id) FROM incidents.patron_age_range), 1));

INSERT INTO incidents.templates (id, name, description, category, fields, is_active, version, requires_patron, show_called_emergency) VALUES
    (1, $q$Theft$q$, $q$Patron or library property theft incident$q$, $q$security$q$, $q$[]$q$, true, 1, true, true),
    (2, $q$Harassment$q$, $q$Verbal or other harassment of patrons or staff$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (3, $q$After-hours$q$, $q$Unauthorized presence after operating hours$q$, $q$security$q$, $q$[]$q$, true, 1, true, true),
    (4, $q$Threat$q$, $q$Threatening behavior or statements$q$, $q$security$q$, $q$[]$q$, true, 1, true, true),
    (5, $q$Child Pornography$q$, $q$Illegal content on library computers or devices$q$, $q$security$q$, $q$[]$q$, true, 1, true, true),
    (6, $q$Stalking$q$, $q$Persistent unwanted attention or following$q$, $q$security$q$, $q$[]$q$, true, 1, true, true),
    (7, $q$Disturbance$q$, $q$Disruptive behavior affecting others$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (8, $q$Non-Compliance with Staff$q$, $q$Refusal to follow staff instructions$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (9, $q$Hate Speech/Hate Crime$q$, $q$Discriminatory speech or actions$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (10, $q$Assault$q$, $q$Physical attack or violence$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (11, $q$Alcohol$q$, $q$Alcohol possession or consumption on premises$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (12, $q$Drug (Use)$q$, $q$Drug use on library premises$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (13, $q$Drug (Paraphernalia)$q$, $q$Drug paraphernalia found or observed$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (14, $q$Emergency (Medical)$q$, $q$Medical emergency requiring immediate attention$q$, $q$medical$q$, $q$[]$q$, true, 1, true, true),
    (15, $q$Emergency (Narcan Use)$q$, $q$Opioid overdose requiring naloxone administration$q$, $q$medical$q$, $q$[]$q$, true, 1, true, true),
    (16, $q$Medical Illness (Non-Emergency)$q$, $q$Non-emergency medical situation$q$, $q$medical$q$, $q$[]$q$, true, 1, true, true),
    (17, $q$Accident (Patron)$q$, $q$Accident involving a patron$q$, $q$medical$q$, $q$[]$q$, true, 1, true, true),
    (18, $q$Bloodborne Pathogen (BBP)$q$, $q$Exposure to blood or bodily fluids$q$, $q$medical$q$, $q$[]$q$, true, 1, true, true),
    (19, $q$Wellness Check$q$, $q$Check on patron welfare or safety$q$, $q$medical$q$, $q$[]$q$, true, 1, true, true),
    (20, $q$Emergency (Building)$q$, $q$Building emergency (fire, gas leak, etc.)$q$, $q$facility$q$, $q$[]$q$, true, 1, false, true),
    (21, $q$Accident (Vehicle)$q$, $q$Vehicle accident on library property$q$, $q$facility$q$, $q$[]$q$, true, 1, true, true),
    (22, $q$Smoking/Vaping$q$, $q$Smoking or vaping violation$q$, $q$policy$q$, $q$[]$q$, true, 1, true, true),
    (23, $q$Safe Place$q$, $q$Safe Place program activation$q$, $q$general$q$, $q$[]$q$, true, 1, false, true),
    (24, $q$Unattended Minor$q$, $q$Minor child left unattended$q$, $q$general$q$, $q$[]$q$, true, 1, false, true),
    (25, $q$Vulnerable Adult$q$, $q$Concern regarding vulnerable adult$q$, $q$general$q$, $q$[]$q$, true, 1, true, true),
    (26, $q$Migration$q$, $q$Placeholder for Migrated Incidents$q$, $q$general$q$, $q$[]$q$, true, 1, true, true),
    (27, $q$Ban/Trespass Violation$q$, $q$Ban/Trespass Violation$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (28, $q$Vandalism$q$, $q$Vandalism$q$, $q$behavior$q$, $q$[]$q$, true, 1, true, true),
    (29, $q$Cybercrime$q$, $q$Cybercrime$q$, $q$security$q$, $q$[]$q$, true, 1, true, true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('incidents.templates_id_seq', GREATEST((SELECT MAX(id) FROM incidents.templates), 1));

INSERT INTO incidents.sub_locations (id, label, description, code, org_unit) VALUES
    (58, $q$Meeting or Study Room$q$, $q$Meeting rooms and study spaces$q$, $q$OLS-MSR$q$, '5eed0000-0000-4000-a000-000000000201'),
    (59, $q$Parking Lot or Garage$q$, $q$Parking areas and garages$q$, $q$OLS-PLG$q$, '5eed0000-0000-4000-a000-000000000201'),
    (60, $q$Lobby$q$, $q$Main entrance and lobby area$q$, $q$OLS-LOB$q$, '5eed0000-0000-4000-a000-000000000201'),
    (61, $q$Outside$q$, $q$Outdoor areas around the building$q$, $q$OLS-OUT$q$, '5eed0000-0000-4000-a000-000000000201'),
    (62, $q$Elevator$q$, $q$Elevator areas$q$, $q$OLS-ELE$q$, '5eed0000-0000-4000-a000-000000000201'),
    (63, $q$Restrooms$q$, $q$Public restrooms$q$, $q$OLS-RES$q$, '5eed0000-0000-4000-a000-000000000201'),
    (64, $q$Makerspace$q$, $q$Creative and technology workspace$q$, $q$OLS-MAK$q$, '5eed0000-0000-4000-a000-000000000201')
ON CONFLICT (id) DO UPDATE SET
    label = EXCLUDED.label, description = EXCLUDED.description, code = EXCLUDED.code;
SELECT setval('incidents.sub_locations_id_seq', GREATEST((SELECT MAX(id) FROM incidents.sub_locations), 1));

INSERT INTO incidents.ban_letter_template (id, subject, body, is_default, name, is_trespass, operation_type, created_by, updated_by) VALUES
    (1, $q$Notice of Library Ban$q$, $q$<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .tmpl-body {
            font-family: Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.5;
            color: #000;
            max-width: 8.5in;
            margin: 0;
            padding: 0;
        }
        .tmpl-page-container {
            display: flex;
            gap: 5px;
        }
        .tmpl-branch-list-sidebar {
            width: 160px;
            flex-shrink: 0;
            font-size: 7pt;
            border-right: none;
            padding-right: 8px;
            line-height: 1.4;
            letter-spacing: -0.3px;
        }
        .tmpl-branch-list-sidebar div {
            margin-bottom: 2px;
        }
        .tmpl-main-content {
            flex: 1;
            min-width: 0;
        }
        .tmpl-logo {
            width: 60px;
            height: auto;
            margin-bottom: 6px;
            display: block;
        }
        .tmpl-header {
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 9.5pt;
        }
        .tmpl-header-line {
            margin-bottom: 3px;
        }
        .tmpl-subject {
            font-weight: bold;
            margin: 30px 0 25px 0;
        }
        .tmpl-salutation {
            margin: 20px 0 15px 0;
        }
        .tmpl-body-text {
            margin: 12px 0;
        }
        .tmpl-underline {
            text-decoration: underline;
        }
        .tmpl-emphasis {
            font-style: italic;
        }
        .tmpl-violation-list {
            margin: 15px 0 15px 30px;
        }
        .tmpl-specifically-box {
            margin-bottom: 30px;
        }
        .tmpl-violation-item {
            margin: 8px 0;
            display: flex;
            align-items: flex-start;
        }
        .tmpl-checkbox {
            width: 12px;
            height: 12px;
            border: 1.5px solid #000;
            display: inline-block;
            margin-right: 8px;
            flex-shrink: 0;
            margin-top: 2px;
            font-size: 8pt;
        }
        .tmpl-checkbox.tmpl-checked::before {
            content: "✓";
            display: block;
            text-align: center;
            font-weight: bold;
            line-height: 12px;
        }
        .tmpl-closing {
            margin: 25px 0 10px 0;
        }
        .tmpl-signature {
            margin: 30px 0 10px 0;
        }
        .tmpl-footer {
            margin-top: 40px;
            text-align: center;
            font-size: 9pt;
            border-top: 1px solid #ccc;
            padding-top: 10px;
        }
    </style>
</head>
<body>
    <div class="tmpl-body">
    <div class="tmpl-page-container">
        <!-- Branch List Sidebar -->
        <div class="tmpl-branch-list-sidebar">
            <div class="tmpl-logo" style="font-weight:bold;font-size:12pt;">Odo Library System</div>
            <div>Main Street</div>
            <div>Riverside</div>
            <div>Hilltop</div>
            <div>Lakeside</div>
        </div>
        <!-- Main Letter Content -->
        <div class="tmpl-main-content">
            <div class="tmpl-header">
                <div class="tmpl-header-line">Date: <span class="tmpl-underline">{{date}}</span></div>
                <div class="tmpl-header-line">Patron Name: <span class="tmpl-underline">{{patron_name}}</span></div>
                <div class="tmpl-header-line">Street Address: <span class="tmpl-underline">{{street_address}}</span></div>
                <div class="tmpl-header-line">City, State &amp; Zip: <span class="tmpl-underline">{{city_state_zip}}</span></div>
            </div>

            <div class="tmpl-subject">RE: Notice of Library Ban</div>

            <div class="tmpl-salutation">Dear <span class="tmpl-underline">{{patron_first_name}}</span>:</div>

            <div class="tmpl-body-text">
                This letter serves as an official notice that you have been banned from the following
                Odo Library System branch: <span class="tmpl-underline">{{branch_name}}</span> per applicable law and library policy.
            </div>

            <div class="tmpl-body-text">
                The library ban is effective from <span class="tmpl-underline">{{start_date}}</span> to <span class="tmpl-underline">{{end_date}}</span>.
                If you enter the <span class="tmpl-underline">{{branch_name}}</span> Library before the ban expires, the duration of
                the ban may be extended for an additional period of time.
            </div>

            <div class="tmpl-body-text">
                The library ban was issued by library staff for willfully and/or persistently violating the
                library <span class="tmpl-emphasis">Code of Conduct</span>. Specifically, you were observed:
            </div>

            <div class="tmpl-violation-list">
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Engaging in unsafe or disruptive behavior</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Using library privileges, materials, equipment, fixtures, furniture, buildings or grounds inappropriately</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Engaging in behavior that is prohibited by law</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Disobeying the direction of a library staff member and/or remaining on library property when requested to leave</span>
                </div>
            </div>

            <div class="tmpl-specifically-box">
                <div class="tmpl-specifically-label">Specifically:</div>
            </div>

            <div class="tmpl-body-text">
                If you have any questions or concerns regarding this notice of ban, please contact any
                member of the Library''s management team.
            </div>

            <div class="tmpl-closing">Regards,</div>

            <div class="tmpl-signature"><em>{{signature}}</em></div>

            <div style="margin-top: 40px;">
                Enclosure: Library Code of Conduct Policy
            </div>
        </div>
    </div>

    <div class="tmpl-footer">
        Odo Library System • 123 Library Way, Exampleville • 555-0100 • odo.example.org
    </div>
    </div>

</body>
</html>
$q$, true, $q$Ban Letter$q$, false, $q$created$q$, '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-a000-000000000002'),
    (2, $q$Notice of Official Trespass$q$, $q$<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .tmpl-body {
            font-family: Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.5;
            color: #000;
            max-width: 8.5in;
            margin: 0;
            padding: 0;
        }
        .tmpl-page-container {
            display: flex;
            gap: 5px;
        }
        .tmpl-branch-list-sidebar {
            width: 160px;
            flex-shrink: 0;
            font-size: 7pt;
            border-right: none;
            padding-right: 8px;
            line-height: 1.4;
            letter-spacing: -0.3px;
        }
        .tmpl-branch-list-sidebar div {
            margin-bottom: 2px;
        }
        .tmpl-main-content {
            flex: 1;
            min-width: 0;
        }
        .tmpl-logo {
            width: 60px;
            height: auto;
            margin-bottom: 6px;
            display: block;
        }
        .tmpl-header {
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 9.5pt;
        }
        .tmpl-header-line {
            margin-bottom: 3px;
        }
        .tmpl-subject {
            font-weight: bold;
            margin: 30px 0 25px 0;
        }
        .tmpl-salutation {
            margin: 20px 0 15px 0;
        }
        .tmpl-body-text {
            margin: 12px 0;
        }
        .tmpl-underline {
            text-decoration: underline;
        }
        .tmpl-emphasis {
            font-style: italic;
        }
        .tmpl-violation-list {
            margin: 15px 0 15px 30px;
        }
        .tmpl-specifically-box {
            margin-bottom: 30px;
        }
        .tmpl-violation-item {
            margin: 8px 0;
            display: flex;
            align-items: flex-start;
        }
        .tmpl-checkbox {
            width: 12px;
            height: 12px;
            border: 1.5px solid #000;
            display: inline-block;
            margin-right: 8px;
            flex-shrink: 0;
            margin-top: 2px;
            font-size: 8pt;
        }
        .tmpl-checkbox.tmpl-checked::before {
            content: "✓";
            display: block;
            text-align: center;
            font-weight: bold;
            line-height: 12px;
        }
        .tmpl-closing {
            margin: 25px 0 10px 0;
        }
        .tmpl-signature {
            margin: 30px 0 10px 0;
        }
        .tmpl-footer {
            margin-top: 40px;
            text-align: center;
            font-size: 9pt;
            border-top: 1px solid #ccc;
            padding-top: 10px;
        }
    </style>
</head>
<body>
    <div class="tmpl-body">
    <div class="tmpl-page-container">
        <!-- Branch List Sidebar -->
        <div class="tmpl-branch-list-sidebar">
            <div class="tmpl-logo" style="font-weight:bold;font-size:12pt;">Odo Library System</div>
            <div>Main Street</div>
            <div>Riverside</div>
            <div>Hilltop</div>
            <div>Lakeside</div>
        </div>
        <!-- Main Letter Content -->
        <div class="tmpl-main-content">
            <div class="tmpl-header">
                <div class="tmpl-header-line">Date: <span class="tmpl-underline">{{date}}</span></div>
                <div class="tmpl-header-line">Patron Name: <span class="tmpl-underline">{{patron_name}}</span></div>
                <div class="tmpl-header-line">Street Address: <span class="tmpl-underline">{{street_address}}</span></div>
                <div class="tmpl-header-line">City, State &amp; Zip: <span class="tmpl-underline">{{city_state_zip}}</span></div>
            </div>

            <div class="tmpl-subject">RE: Notice of Official Trespass</div>

            <div class="tmpl-salutation">Dear <span class="tmpl-underline">{{patron_first_name}}</span>:</div>

            <div class="tmpl-body-text">
                This letter serves as an official notice that you have been trespassed from the
                Odo Library System for a period of <span class="tmpl-underline">{{duration_months}}</span> months.
            </div>

            <div class="tmpl-body-text">
                The official trespass, issued by <span class="tmpl-underline">{{law_enforcement_agency}}</span> <span class="tmpl-emphasis">(law enforcement agency)</span>, is effective for all
                Odo Library System locations (listed to the left) and all other
                Odo Library System facilities from <span class="tmpl-underline">{{start_date}}</span> to <span class="tmpl-underline">{{end_date}}</span>. If you enter any Odo Library System
                library or return to library grounds before the trespass expires, you may be subject
                to arrest.
            </div>

            <div class="tmpl-body-text">
                The trespass was issued at the request of library staff for actively threatening staff
                or other patrons, or for being so disruptive that the library cannot be used safely
                and comfortably. You were observed:
            </div>

            <div class="tmpl-violation-list">
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Actively threatening staff or others</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Being so disruptive that the library cannot be used safely</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Engaging in illegal behavior</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Violating a previous ban of one (1) year or longer</span>
                </div>
            </div>

            <div class="tmpl-specifically-box">
                <div class="tmpl-specifically-label">Specifically:</div>
            </div>

            <div class="tmpl-body-text">
                If you have any questions regarding this notice of trespass, please contact
                the Community Conduct Coordinator at conduct@example.org.
                If you wish to appeal this trespass, an appeal must be submitted in writing to the
                address listed below within 30 days of the trespass issue date.
            </div>

            <div class="tmpl-closing">Regards,</div>

            <div class="tmpl-signature"><em>{{signature}}</em></div>

            <div style="margin-top: 40px;">
                Enclosure: Library Code of Conduct Policy
            </div>
        </div>
    </div>

    <div class="tmpl-footer">
        Odo Library System • 123 Library Way, Exampleville • 555-0100 • odo.example.org
    </div>
    </div>

</body>
</html>
$q$, true, $q$Trespass Letter$q$, true, $q$created$q$, '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-a000-000000000002'),
    (3, $q$Notice of Library Ban Extension$q$, $q$<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .tmpl-body {
            font-family: Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.5;
            color: #000;
            max-width: 8.5in;
            margin: 0;
            padding: 0;
        }
        .tmpl-page-container {
            display: flex;
            gap: 5px;
        }
        .tmpl-branch-list-sidebar {
            width: 160px;
            flex-shrink: 0;
            font-size: 7pt;
            border-right: none;
            padding-right: 8px;
            line-height: 1.4;
            letter-spacing: -0.3px;
        }
        .tmpl-branch-list-sidebar div {
            margin-bottom: 2px;
        }
        .tmpl-main-content {
            flex: 1;
            min-width: 0;
        }
        .tmpl-logo {
            width: 60px;
            height: auto;
            margin-bottom: 6px;
            display: block;
        }
        .tmpl-header {
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 9.5pt;
        }
        .tmpl-header-line {
            margin-bottom: 3px;
        }
        .tmpl-subject {
            font-weight: bold;
            margin: 30px 0 25px 0;
        }
        .tmpl-salutation {
            margin: 20px 0 15px 0;
        }
        .tmpl-body-text {
            margin: 12px 0;
        }
        .tmpl-underline {
            text-decoration: underline;
        }
        .tmpl-emphasis {
            font-style: italic;
        }
        .tmpl-violation-list {
            margin: 15px 0 15px 30px;
        }
        .tmpl-specifically-box {
            margin-bottom: 30px;
        }
        .tmpl-violation-item {
            margin: 8px 0;
            display: flex;
            align-items: flex-start;
        }
        .tmpl-checkbox {
            width: 12px;
            height: 12px;
            border: 1.5px solid #000;
            display: inline-block;
            margin-right: 8px;
            flex-shrink: 0;
            margin-top: 2px;
            font-size: 8pt;
        }
        .tmpl-checkbox.tmpl-checked::before {
            content: "✓";
            display: block;
            text-align: center;
            font-weight: bold;
            line-height: 12px;
        }
        .tmpl-closing {
            margin: 25px 0 10px 0;
        }
        .tmpl-signature {
            margin: 30px 0 10px 0;
        }
        .tmpl-footer {
            margin-top: 40px;
            text-align: center;
            font-size: 9pt;
            border-top: 1px solid #ccc;
            padding-top: 10px;
        }
    </style>
</head>
<body>
    <div class="tmpl-body">
    <div class="tmpl-page-container">
        <!-- Branch List Sidebar -->
        <div class="tmpl-branch-list-sidebar">
            <div class="tmpl-logo" style="font-weight:bold;font-size:12pt;">Odo Library System</div>
            <div>Main Street</div>
            <div>Riverside</div>
            <div>Hilltop</div>
            <div>Lakeside</div>
        </div>
        <!-- Main Letter Content -->
        <div class="tmpl-main-content">
            <div class="tmpl-header">
                <div class="tmpl-header-line">Date: <span class="tmpl-underline">{{date}}</span></div>
                <div class="tmpl-header-line">Patron Name: <span class="tmpl-underline">{{patron_name}}</span></div>
                <div class="tmpl-header-line">Street Address: <span class="tmpl-underline">{{street_address}}</span></div>
                <div class="tmpl-header-line">City, State &amp; Zip: <span class="tmpl-underline">{{city_state_zip}}</span></div>
            </div>

            <div class="tmpl-subject">RE: Notice of Library Ban Extension</div>

            <div class="tmpl-salutation">Dear <span class="tmpl-underline">{{patron_first_name}}</span>:</div>

            <div class="tmpl-body-text">
                This letter serves as an official notice that your ban from the following
                Odo Library System branch: <span class="tmpl-underline">{{branch_name}}</span>
                has been extended per applicable law and library policy.
            </div>

            <div class="tmpl-body-text">
                The library ban is now effective from <span class="tmpl-underline">{{start_date}}</span> to <span class="tmpl-underline">{{end_date}}</span>.
                If you enter the <span class="tmpl-underline">{{branch_name}}</span> Library before the ban expires, the duration of
                the ban may be extended for an additional period of time.
            </div>

            <div class="tmpl-body-text">
                The library ban extension was issued by library staff for continued and/or repeated violations of the
                library <span class="tmpl-emphasis">Code of Conduct</span>. Specifically, you were observed:
            </div>

            <div class="tmpl-violation-list">
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Engaging in unsafe or disruptive behavior</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Using library privileges, materials, equipment, fixtures, furniture, buildings or grounds inappropriately</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Engaging in behavior that is prohibited by law</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Disobeying the direction of a library staff member and/or remaining on library property when requested to leave</span>
                </div>
            </div>

            <div class="tmpl-specifically-box">
                <div class="tmpl-specifically-label">Specifically:</div>
            </div>

            <div class="tmpl-body-text">
                If you have any questions or concerns regarding this notice of ban extension, please contact any
                member of the Library''s management team.
            </div>

            <div class="tmpl-closing">Regards,</div>

            <div class="tmpl-signature">{{signature}}</div>

            <div style="margin-top: 40px;">
                Enclosure: Library Code of Conduct Policy
            </div>
        </div>
    </div>

    <div class="tmpl-footer">
        Odo Library System • 123 Library Way, Exampleville • 555-0100 • odo.example.org
    </div>
    </div>

</body>
</html>
$q$, true, $q$Ban Extension Letter$q$, false, $q$extended$q$, '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-a000-000000000002'),
    (4, $q$Notice of Official Trespass Extension$q$, $q$<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .tmpl-body {
            font-family: Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.5;
            color: #000;
            max-width: 8.5in;
            margin: 0;
            padding: 0;
        }
        .tmpl-page-container {
            display: flex;
            gap: 5px;
        }
        .tmpl-branch-list-sidebar {
            width: 160px;
            flex-shrink: 0;
            font-size: 7pt;
            border-right: none;
            padding-right: 8px;
            line-height: 1.4;
            letter-spacing: -0.3px;
        }
        .tmpl-branch-list-sidebar div {
            margin-bottom: 2px;
        }
        .tmpl-main-content {
            flex: 1;
            min-width: 0;
        }
        .tmpl-logo {
            width: 60px;
            height: auto;
            margin-bottom: 6px;
            display: block;
        }
        .tmpl-header {
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 9.5pt;
        }
        .tmpl-header-line {
            margin-bottom: 3px;
        }
        .tmpl-subject {
            font-weight: bold;
            margin: 30px 0 25px 0;
        }
        .tmpl-salutation {
            margin: 20px 0 15px 0;
        }
        .tmpl-body-text {
            margin: 12px 0;
        }
        .tmpl-underline {
            text-decoration: underline;
        }
        .tmpl-emphasis {
            font-style: italic;
        }
        .tmpl-violation-list {
            margin: 15px 0 15px 30px;
        }
        .tmpl-specifically-box {
            margin-bottom: 30px;
        }
        .tmpl-violation-item {
            margin: 8px 0;
            display: flex;
            align-items: flex-start;
        }
        .tmpl-checkbox {
            width: 12px;
            height: 12px;
            border: 1.5px solid #000;
            display: inline-block;
            margin-right: 8px;
            flex-shrink: 0;
            margin-top: 2px;
            font-size: 8pt;
        }
        .tmpl-checkbox.tmpl-checked::before {
            content: "✓";
            display: block;
            text-align: center;
            font-weight: bold;
            line-height: 12px;
        }
        .tmpl-closing {
            margin: 25px 0 10px 0;
        }
        .tmpl-signature {
            margin: 30px 0 10px 0;
        }
        .tmpl-footer {
            margin-top: 40px;
            text-align: center;
            font-size: 9pt;
            border-top: 1px solid #ccc;
            padding-top: 10px;
        }
    </style>
</head>
<body>
    <div class="tmpl-body">
    <div class="tmpl-page-container">
        <!-- Branch List Sidebar -->
        <div class="tmpl-branch-list-sidebar">
            <div class="tmpl-logo" style="font-weight:bold;font-size:12pt;">Odo Library System</div>
            <div>Main Street</div>
            <div>Riverside</div>
            <div>Hilltop</div>
            <div>Lakeside</div>
        </div>
        <!-- Main Letter Content -->
        <div class="tmpl-main-content">
            <div class="tmpl-header">
                <div class="tmpl-header-line">Date: <span class="tmpl-underline">{{date}}</span></div>
                <div class="tmpl-header-line">Patron Name: <span class="tmpl-underline">{{patron_name}}</span></div>
                <div class="tmpl-header-line">Street Address: <span class="tmpl-underline">{{street_address}}</span></div>
                <div class="tmpl-header-line">City, State &amp; Zip: <span class="tmpl-underline">{{city_state_zip}}</span></div>
            </div>

            <div class="tmpl-subject">RE: Notice of Official Trespass Extension</div>

            <div class="tmpl-salutation">Dear <span class="tmpl-underline">{{patron_first_name}}</span>:</div>

            <div class="tmpl-body-text">
                This letter serves as an official notice that your trespass from the
                Odo Library System has been extended for an additional period of
                <span class="tmpl-underline">{{duration_months}}</span> months.
            </div>

            <div class="tmpl-body-text">
                The official trespass extension, issued by <span class="tmpl-underline">{{law_enforcement_agency}}</span>
                <span class="tmpl-emphasis">(law enforcement agency)</span>, is effective for all
                Odo Library System locations (listed to the left) and all other
                Odo Library System facilities from <span class="tmpl-underline">{{start_date}}</span>
                to <span class="tmpl-underline">{{end_date}}</span>. If you enter any Odo Library System
                library or return to library grounds before the trespass expires, you may be subject
                to arrest.
            </div>

            <div class="tmpl-body-text">
                The trespass extension was issued at the request of library staff for continued and/or
                repeated violations. You were observed:
            </div>

            <div class="tmpl-violation-list">
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Actively threatening staff or others</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Being so disruptive that the library cannot be used safely</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Engaging in illegal behavior</span>
                </div>
                <div class="tmpl-violation-item">
                    <span class="tmpl-checkbox"></span>
                    <span>Violating a previous ban of one (1) year or longer</span>
                </div>
            </div>

            <div class="tmpl-specifically-box">
                <div class="tmpl-specifically-label">Specifically:</div>
            </div>

            <div class="tmpl-body-text">
                If you have any questions regarding this notice of trespass extension, please contact
                the Community Conduct Coordinator at conduct@example.org.
                If you wish to appeal this trespass extension, an appeal must be submitted in writing to the
                address listed below within 30 days of the extension issue date.
            </div>

            <div class="tmpl-closing">Regards,</div>

            <div class="tmpl-signature">{{signature}}</div>

            <div style="margin-top: 40px;">
                Enclosure: Library Code of Conduct Policy
            </div>
        </div>
    </div>

    <div class="tmpl-footer">
        Odo Library System • 123 Library Way, Exampleville • 555-0100 • odo.example.org
    </div>
    </div>

</body>
</html>
$q$, true, $q$Trespass Extension Letter$q$, true, $q$extended$q$, '5eed0000-0000-4000-a000-000000000002', '5eed0000-0000-4000-a000-000000000002')
ON CONFLICT (id) DO UPDATE SET
    subject = EXCLUDED.subject, body = EXCLUDED.body,
    is_default = EXCLUDED.is_default, name = EXCLUDED.name,
    is_trespass = EXCLUDED.is_trespass, operation_type = EXCLUDED.operation_type;
SELECT setval('incidents.ban_letter_template_id_seq', GREATEST((SELECT MAX(id) FROM incidents.ban_letter_template), 1));

COMMIT;
