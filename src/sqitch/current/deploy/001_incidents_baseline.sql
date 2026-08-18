-- Deploy current:001_incidents_baseline to pg

-- Baseline: the incidents schema as it stood on the shared odo database
-- at the repo split (2026-08), re-homed into Current's own database. A
-- one-time snapshot (pg_dump), not a replay of history; the schema is
-- fully self-contained (cross-database references to odo entities are
-- stable uuids, never foreign keys). From here the schema evolves via
-- new sqitch changes in this plan.

BEGIN;

-- Local audit helper. The incidents updated_at triggers below call
-- audit.set_updated_at(); in the shared database that function lived in
-- the audit schema. Current's own database carries a local copy so the
-- triggers keep working unchanged.
CREATE SCHEMA IF NOT EXISTS audit;

CREATE OR REPLACE FUNCTION audit.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

--
-- PostgreSQL database dump
--

\restrict KcfzNKDCQUhiR1JuXSjNy1bBom9zDFYycPWTBZ2Y7MexBuj9xw6DdYktptXeibc

-- Dumped from database version 18.4 (Ubuntu 18.4-1.pgdg24.04+1)
-- Dumped by pg_dump version 18.4 (Ubuntu 18.4-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: incidents; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA incidents;


--
-- Name: calculate_risk_score(integer); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.calculate_risk_score(p_patron_id integer) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    risk_score NUMERIC := 0;
    incident_count INTEGER;
    ban_count INTEGER;
    recent_incident_count INTEGER;
    severity_sum INTEGER;
BEGIN
    -- Count total incidents
    SELECT COUNT(*) INTO incident_count
    FROM incidents.involved_parties ip
    JOIN incidents.incidents i ON i.id = ip.incident_id
    WHERE ip.patron_id = p_patron_id
    AND ip.party_type = 'patron'
    AND i.deleted_at IS NULL;
    
    -- Count bans
    SELECT COUNT(*) INTO ban_count
    FROM incidents.patron_bans
    WHERE patron_id = p_patron_id;
    
    -- Count recent incidents (last 90 days)
    SELECT COUNT(*) INTO recent_incident_count
    FROM incidents.involved_parties ip
    JOIN incidents.incidents i ON i.id = ip.incident_id
    WHERE ip.patron_id = p_patron_id
    AND ip.party_type = 'patron'
    AND i.created_at >= CURRENT_DATE - INTERVAL '90 days'
    AND i.deleted_at IS NULL;
    
    -- Sum incident severities
    SELECT COALESCE(SUM(
        CASE i.priority
            WHEN 'urgent' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 1
            ELSE 0
        END
    ), 0) INTO severity_sum
    FROM incidents.involved_parties ip
    JOIN incidents.incidents i ON i.id = ip.incident_id
    WHERE ip.patron_id = p_patron_id
    AND ip.party_type = 'patron'
    AND i.deleted_at IS NULL;
    
    -- Calculate risk score
    risk_score := (incident_count * 2) + 
                  (ban_count * 10) + 
                  (recent_incident_count * 3) + 
                  (severity_sum);
    
    RETURN risk_score;
END;
$$;


--
-- Name: cleanup_orphaned_review_group(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.cleanup_orphaned_review_group() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if the reviewer_group from the deleted chain
    -- has any other references in review_chain
    IF NOT EXISTS (
        SELECT 1 FROM incidents.review_chain
        WHERE reviewer_group = OLD.reviewer_group
    ) THEN
        -- No other chains reference this group, delete it
        DELETE FROM incidents.review_group
        WHERE id = OLD.reviewer_group;
    END IF;

    RETURN OLD;
END;
$$;


--
-- Name: merge_patrons(integer, integer, uuid); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.merge_patrons(p_primary_id integer, p_secondary_id integer, p_merged_by uuid) RETURNS TABLE(incidents_transferred integer, photos_transferred integer, bans_transferred integer, notes_transferred integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_merge_data JSONB;
    v_incidents_count INTEGER := 0;
    v_photos_count INTEGER := 0;
    v_bans_count INTEGER := 0;
    v_notes_count INTEGER := 0;
    v_secondary_name TEXT;
BEGIN
    IF p_primary_id = p_secondary_id THEN
        RAISE EXCEPTION 'Cannot merge a patron with itself';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM incidents.patrons WHERE id = p_primary_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Primary patron % not found or deleted', p_primary_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM incidents.patrons WHERE id = p_secondary_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Secondary patron % not found or deleted', p_secondary_id;
    END IF;

    SELECT COUNT(*) INTO v_photos_count
    FROM incidents.patron_photo WHERE patron = p_secondary_id;

    SELECT COUNT(*) INTO v_bans_count
    FROM incidents.patron_ban WHERE patron = p_secondary_id;

    SELECT COUNT(*) INTO v_notes_count
    FROM incidents.patron_notes WHERE patron_id = p_secondary_id AND deleted_at IS NULL;

    -- Skip transfer if primary already involved in same incident (avoids FK constraint violation)
    -- Count via GET DIAGNOSTICS so same-incident skips don't inflate the reported number
    UPDATE incidents.involved_parties ip
    SET patron_id = p_primary_id
    WHERE ip.patron_id = p_secondary_id
      AND NOT EXISTS (
          SELECT 1 FROM incidents.involved_parties ep
          WHERE ep.incident_id = ip.incident_id
            AND ep.patron_id = p_primary_id
      );
    GET DIAGNOSTICS v_incidents_count = ROW_COUNT;

    DELETE FROM incidents.involved_parties
    WHERE patron_id = p_secondary_id;

    UPDATE incidents.patron_ban
    SET patron = p_primary_id
    WHERE patron = p_secondary_id;

    UPDATE incidents.patron_notes
    SET patron_id = p_primary_id
    WHERE patron_id = p_secondary_id;

    -- Demote secondary's primary photo to avoid unique index violation
    UPDATE incidents.patron_photo
    SET is_primary = false
    WHERE patron = p_secondary_id AND is_primary;

    UPDATE incidents.patron_photo
    SET patron = p_primary_id
    WHERE patron = p_secondary_id;

    UPDATE incidents.patron_timeline_events
    SET patron_id = p_primary_id
    WHERE patron_id = p_secondary_id;

    SELECT to_jsonb(p.*) INTO v_merge_data
    FROM incidents.patrons p WHERE p.id = p_secondary_id;

    UPDATE incidents.patrons
    SET deleted_at = NOW()
    WHERE id = p_secondary_id;

    v_secondary_name := COALESCE(
        v_merge_data->>'first_name', ''
    ) || ' ' || COALESCE(
        v_merge_data->>'last_name', ''
    );

    INSERT INTO incidents.patron_timeline_events (
        patron_id, event_type, event_data, created_by
    ) VALUES (
        p_primary_id,
        'patron_merged',
        jsonb_build_object(
            'merged_patron_id', p_secondary_id,
            'merged_patron_name', TRIM(v_secondary_name)
        ),
        p_merged_by
    );

    RETURN QUERY SELECT
        v_incidents_count,
        v_photos_count,
        v_bans_count,
        v_notes_count;
END;
$$;


--
-- Name: patrons_set_display_name(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.patrons_set_display_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.display_name := TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  RETURN NEW;
END;
$$;


--
-- Name: refresh_daily_statistics(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.refresh_daily_statistics() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY incidents.daily_statistics;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: patron_ban; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.patron_ban (
    id integer NOT NULL,
    patron integer NOT NULL,
    incident integer NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    comments text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_trespass boolean DEFAULT false NOT NULL,
    archives_at timestamp with time zone,
    lifts_at timestamp with time zone DEFAULT (((((CURRENT_DATE + '30 days'::interval))::date || ' 00:00:00'::text))::timestamp without time zone AT TIME ZONE 'America/Los_Angeles'::text) NOT NULL,
    org_unit uuid CONSTRAINT patron_ban_org_unit_uuid_not_null NOT NULL,
    archived_by uuid,
    created_by uuid CONSTRAINT patron_ban_created_by_uuid_not_null NOT NULL,
    lifted_by uuid,
    updated_by uuid CONSTRAINT patron_ban_updated_by_uuid_not_null NOT NULL
);


--
-- Name: active_patron_ban; Type: VIEW; Schema: incidents; Owner: -
--

CREATE VIEW incidents.active_patron_ban AS
 SELECT id,
    patron,
    incident,
    org_unit,
    starts_at,
    comments,
    created_by,
    created_at,
    updated_by,
    updated_at,
    lifted_by,
    is_trespass,
    archived_by,
    archives_at,
    lifts_at
   FROM incidents.patron_ban
  WHERE ((archived_by IS NULL) AND ((archives_at IS NULL) OR (archives_at > now())));


--
-- Name: activity_log; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.activity_log (
    id bigint NOT NULL,
    event_type character varying(64) NOT NULL,
    incident_id integer,
    ban_id integer,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_unit uuid,
    actor_id uuid CONSTRAINT activity_log_actor_id_uuid_not_null NOT NULL
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.activity_log_id_seq OWNED BY incidents.activity_log.id;


--
-- Name: attachments; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.attachments (
    id integer NOT NULL,
    incident_id integer,
    activity_log_id bigint,
    file_upload uuid,
    CONSTRAINT attachments_parent_check CHECK (((incident_id IS NOT NULL) OR (activity_log_id IS NOT NULL)))
);


--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.attachments_id_seq OWNED BY incidents.attachments.id;


--
-- Name: ban_letter_template; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.ban_letter_template (
    id integer NOT NULL,
    subject text,
    body text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    name text,
    is_trespass boolean DEFAULT false NOT NULL,
    operation_type text DEFAULT 'created'::text NOT NULL,
    created_by uuid CONSTRAINT ban_letter_template_created_by_uuid_not_null NOT NULL,
    deleted_by uuid,
    updated_by uuid CONSTRAINT ban_letter_template_updated_by_uuid_not_null NOT NULL
);


--
-- Name: ban_letter_template_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.ban_letter_template_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ban_letter_template_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.ban_letter_template_id_seq OWNED BY incidents.ban_letter_template.id;


--
-- Name: categories; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.categories (
    code character varying(50) NOT NULL,
    label character varying(100) NOT NULL,
    description text,
    icon character varying(10),
    display_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: external_link; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.external_link (
    id integer NOT NULL,
    incident integer,
    url text NOT NULL,
    title text NOT NULL,
    link_type integer,
    description text,
    restricted_access boolean DEFAULT false NOT NULL,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    activity_log_id bigint,
    added_by uuid,
    CONSTRAINT external_link_parent_check CHECK (((incident IS NOT NULL) OR (activity_log_id IS NOT NULL)))
);


--
-- Name: TABLE external_link; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON TABLE incidents.external_link IS 'External links and references associated with incidents';


--
-- Name: COLUMN external_link.link_type; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.external_link.link_type IS 'Type of external link (nullable, not used in UI)';


--
-- Name: COLUMN external_link.restricted_access; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.external_link.restricted_access IS 'Whether this link requires special permissions to access';


--
-- Name: external_link_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.external_link_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_link_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.external_link_id_seq OWNED BY incidents.external_link.id;


--
-- Name: external_link_type; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.external_link_type (
    id integer NOT NULL,
    label text NOT NULL,
    description text,
    display_order integer DEFAULT 100,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: TABLE external_link_type; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON TABLE incidents.external_link_type IS 'Types of external links that can be associated with incidents';


--
-- Name: external_link_type_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.external_link_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_link_type_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.external_link_type_id_seq OWNED BY incidents.external_link_type.id;


--
-- Name: generated_ban_letter; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.generated_ban_letter (
    id integer NOT NULL,
    ban integer NOT NULL,
    template integer,
    content text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    activity_log_id bigint,
    incident integer,
    generated_by_org uuid,
    generated_by uuid CONSTRAINT generated_ban_letter_generated_by_uuid_not_null NOT NULL
);


--
-- Name: generated_ban_letter_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.generated_ban_letter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generated_ban_letter_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.generated_ban_letter_id_seq OWNED BY incidents.generated_ban_letter.id;


--
-- Name: incident_links; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.incident_links (
    id integer NOT NULL,
    incident_id integer NOT NULL,
    linked_incident_id integer NOT NULL,
    link_type character varying(50) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by uuid,
    CONSTRAINT chk_different_incidents CHECK ((incident_id <> linked_incident_id)),
    CONSTRAINT chk_link_type CHECK (((link_type)::text = ANY (ARRAY[('related'::character varying)::text, ('duplicate'::character varying)::text, ('followup'::character varying)::text, ('pattern'::character varying)::text])))
);


--
-- Name: incident_links_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.incident_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_links_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.incident_links_id_seq OWNED BY incidents.incident_links.id;


--
-- Name: incident_review; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.incident_review (
    id integer NOT NULL,
    incident integer NOT NULL,
    reviewed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    result text NOT NULL,
    min_review_level integer DEFAULT 1 CONSTRAINT incident_review_level_not_null NOT NULL,
    comments text,
    reviewed_by uuid CONSTRAINT incident_review_reviewed_by_uuid_not_null NOT NULL,
    CONSTRAINT incident_review_result_check CHECK ((result = ANY (ARRAY['submitted'::text, 'approved'::text, 'approved-with-edits'::text, 'returned'::text, 'deleted'::text, 'resolved'::text, 'reopened'::text])))
);


--
-- Name: incident_review_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.incident_review_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_review_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.incident_review_id_seq OWNED BY incidents.incident_review.id;


--
-- Name: incident_template_map; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.incident_template_map (
    id integer NOT NULL,
    incident integer NOT NULL,
    template integer NOT NULL
);


--
-- Name: incident_template_map_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.incident_template_map_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_template_map_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.incident_template_map_id_seq OWNED BY incidents.incident_template_map.id;


--
-- Name: incidents; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.incidents (
    id integer NOT NULL,
    sub_location integer,
    title character varying(500) NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    ai_analysis jsonb,
    emergency_capture boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    resolved_at timestamp with time zone,
    deleted_at timestamp with time zone,
    called_emergency boolean DEFAULT false,
    occurred_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    org_unit uuid CONSTRAINT incidents_org_unit_uuid_not_null NOT NULL,
    created_by uuid CONSTRAINT incidents_created_by_uuid_not_null NOT NULL,
    resolved_by uuid
);


--
-- Name: COLUMN incidents.sub_location; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.sub_location IS 'Optional reference to sub-location within the org_unit where incident occurred';


--
-- Name: incidents_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.incidents_id_seq OWNED BY incidents.incidents.id;


--
-- Name: involved_parties; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.involved_parties (
    id integer NOT NULL,
    incident_id integer NOT NULL,
    party_type character varying(50) NOT NULL,
    patron_id integer,
    external_name character varying(255),
    external_contact character varying(255),
    role character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    staff_id uuid,
    CONSTRAINT chk_party_type CHECK (((party_type)::text = ANY (ARRAY[('patron'::character varying)::text, ('staff'::character varying)::text, ('external'::character varying)::text])))
);


--
-- Name: involved_parties_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.involved_parties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: involved_parties_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.involved_parties_id_seq OWNED BY incidents.involved_parties.id;


--
-- Name: merge_history; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.merge_history (
    id integer NOT NULL,
    primary_patron_id integer NOT NULL,
    merged_patron_id integer NOT NULL,
    merge_data jsonb NOT NULL,
    merged_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    reason text,
    merged_by uuid CONSTRAINT merge_history_merged_by_uuid_not_null NOT NULL
);


--
-- Name: merge_history_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.merge_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merge_history_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.merge_history_id_seq OWNED BY incidents.merge_history.id;


--
-- Name: migration_attachment; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.migration_attachment (
    id integer NOT NULL,
    incident integer NOT NULL,
    patron integer NOT NULL,
    external_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    files_imported_at timestamp with time zone
);


--
-- Name: migration_attachment_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.migration_attachment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migration_attachment_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.migration_attachment_id_seq OWNED BY incidents.migration_attachment.id;


--
-- Name: notification_email_routing; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.notification_email_routing (
    id integer NOT NULL,
    template_code character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_org_unit uuid,
    email_group uuid CONSTRAINT notification_email_routing_email_group_uuid_not_null NOT NULL
);


--
-- Name: notification_email_routing_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.notification_email_routing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_email_routing_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.notification_email_routing_id_seq OWNED BY incidents.notification_email_routing.id;


--
-- Name: patron_age_range; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.patron_age_range (
    id integer NOT NULL,
    label text NOT NULL
);


--
-- Name: patron_age_range_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.patron_age_range_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patron_age_range_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.patron_age_range_id_seq OWNED BY incidents.patron_age_range.id;


--
-- Name: patron_ban_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.patron_ban_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patron_ban_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.patron_ban_id_seq OWNED BY incidents.patron_ban.id;


--
-- Name: patron_notes; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.patron_notes (
    id integer NOT NULL,
    patron_id integer NOT NULL,
    note_type character varying(50) NOT NULL,
    content text NOT NULL,
    incident_id integer,
    visibility character varying(20) DEFAULT 'staff'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    created_by uuid CONSTRAINT patron_notes_created_by_uuid_not_null NOT NULL,
    CONSTRAINT chk_note_type CHECK (((note_type)::text = ANY (ARRAY[('behavior'::character varying)::text, ('interaction'::character varying)::text, ('concern'::character varying)::text, ('positive'::character varying)::text, ('general'::character varying)::text]))),
    CONSTRAINT chk_visibility CHECK (((visibility)::text = ANY (ARRAY[('staff'::character varying)::text, ('manager'::character varying)::text, ('coordinator'::character varying)::text])))
);


--
-- Name: patron_notes_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.patron_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patron_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.patron_notes_id_seq OWNED BY incidents.patron_notes.id;


--
-- Name: patron_photo; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.patron_photo (
    id integer NOT NULL,
    patron integer NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    file_upload uuid CONSTRAINT patron_photo_file_upload_uuid_not_null NOT NULL
);


--
-- Name: patron_photo_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.patron_photo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patron_photo_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.patron_photo_id_seq OWNED BY incidents.patron_photo.id;


--
-- Name: patrons; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.patrons (
    id integer NOT NULL,
    library_card character varying(50),
    first_name character varying(100) NOT NULL,
    middle_name character varying(100),
    last_name character varying(100) NOT NULL,
    preferred_name character varying(200),
    phone character varying(20),
    email character varying(255),
    address_line1 character varying(255),
    address_line2 character varying(255),
    city character varying(100),
    state_province character varying(50),
    postal_code character varying(20),
    country character varying(2) DEFAULT 'US'::character varying,
    photo_url character varying(500),
    identification_type character varying(50),
    identification_number character varying(100),
    risk_level character varying(20) DEFAULT 'low'::character varying,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    display_name text DEFAULT ''::text NOT NULL,
    is_unknown boolean DEFAULT false NOT NULL,
    age_range integer DEFAULT 1 NOT NULL,
    alias text,
    created_by uuid,
    CONSTRAINT chk_risk_level CHECK (((risk_level)::text = ANY (ARRAY[('low'::character varying)::text, ('medium'::character varying)::text, ('high'::character varying)::text, ('severe'::character varying)::text])))
);


--
-- Name: visible_patron_ban; Type: VIEW; Schema: incidents; Owner: -
--

CREATE VIEW incidents.visible_patron_ban AS
 SELECT id,
    patron,
    incident,
    org_unit,
    starts_at,
    comments,
    created_by,
    created_at,
    updated_by,
    updated_at,
    lifted_by,
    is_trespass,
    archived_by,
    archives_at,
    lifts_at
   FROM incidents.patron_ban
  WHERE ((archived_by IS NULL) AND ((archives_at IS NULL) OR (archives_at > now())) AND (lifts_at > now()));


--
-- Name: patron_search_summary; Type: VIEW; Schema: incidents; Owner: -
--

CREATE VIEW incidents.patron_search_summary AS
 WITH activity AS (
         SELECT ip_1.patron_id AS patron,
            ii.org_unit
           FROM (incidents.involved_parties ip_1
             JOIN incidents.incidents ii ON (((ii.id = ip_1.incident_id) AND (ii.deleted_at IS NULL))))
          WHERE (ip_1.patron_id IS NOT NULL)
        UNION
         SELECT vpb.patron,
            vpb.org_unit
           FROM incidents.visible_patron_ban vpb
          WHERE (vpb.lifts_at > now())
        )
 SELECT a.patron AS patron_id,
    a.org_unit,
    ip.library_card,
    ip.first_name,
    ip.middle_name,
    ip.last_name,
    ip.display_name,
    ip.email,
    ip.alias,
    ip.risk_level,
    ip.notes,
    ip.is_unknown,
    ip.deleted_at AS patron_deleted_at,
    ( SELECT count(DISTINCT ii.id) AS count
           FROM (incidents.involved_parties iip
             JOIN incidents.incidents ii ON (((ii.id = iip.incident_id) AND (ii.deleted_at IS NULL))))
          WHERE ((iip.patron_id = a.patron) AND (ii.org_unit = a.org_unit))) AS incident_count,
    ( SELECT max(ii.occurred_at) AS max
           FROM (incidents.involved_parties iip
             JOIN incidents.incidents ii ON (((ii.id = iip.incident_id) AND (ii.deleted_at IS NULL))))
          WHERE ((iip.patron_id = a.patron) AND (ii.org_unit = a.org_unit))) AS last_incident_at,
    ( SELECT min(ii.occurred_at) AS min
           FROM (incidents.involved_parties iip
             JOIN incidents.incidents ii ON (((ii.id = iip.incident_id) AND (ii.deleted_at IS NULL))))
          WHERE ((iip.patron_id = a.patron) AND (ii.org_unit = a.org_unit))) AS first_incident_at,
    ( SELECT count(*) AS count
           FROM incidents.visible_patron_ban vpb
          WHERE ((vpb.patron = a.patron) AND (vpb.org_unit = a.org_unit) AND (vpb.is_trespass = false) AND (vpb.lifts_at > now()))) AS active_ban_count,
    ( SELECT min(vpb.lifts_at) AS min
           FROM incidents.visible_patron_ban vpb
          WHERE ((vpb.patron = a.patron) AND (vpb.org_unit = a.org_unit) AND (vpb.is_trespass = false) AND (vpb.lifts_at > now()))) AS ban_min_lifts_at,
    ( SELECT max(vpb.lifts_at) AS max
           FROM incidents.visible_patron_ban vpb
          WHERE ((vpb.patron = a.patron) AND (vpb.org_unit = a.org_unit) AND (vpb.is_trespass = false) AND (vpb.lifts_at > now()))) AS ban_max_lifts_at,
    ( SELECT count(*) AS count
           FROM incidents.visible_patron_ban vpb
          WHERE ((vpb.patron = a.patron) AND (vpb.is_trespass = true) AND (vpb.lifts_at > now()))) AS active_trespass_count,
    ( SELECT min(vpb.lifts_at) AS min
           FROM incidents.visible_patron_ban vpb
          WHERE ((vpb.patron = a.patron) AND (vpb.is_trespass = true) AND (vpb.lifts_at > now()))) AS trespass_min_lifts_at,
    ( SELECT max(vpb.lifts_at) AS max
           FROM incidents.visible_patron_ban vpb
          WHERE ((vpb.patron = a.patron) AND (vpb.is_trespass = true) AND (vpb.lifts_at > now()))) AS trespass_max_lifts_at,
    ( SELECT ipp.file_upload
           FROM incidents.patron_photo ipp
          WHERE ((ipp.patron = a.patron) AND (ipp.is_primary = true))
         LIMIT 1) AS primary_photo_file_upload
   FROM (activity a
     JOIN incidents.patrons ip ON ((ip.id = a.patron)))
  WHERE (ip.deleted_at IS NULL);


--
-- Name: VIEW patron_search_summary; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON VIEW incidents.patron_search_summary IS 'Per-(patron, org_unit) summary used by patron.search. Self-contained (incidents.* only): org_unit and primary_photo_file_upload are stable odo uuids the app resolves via the odo APIs. See 104_current_uuid_switch.sql.';


--
-- Name: patron_timeline_events; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.patron_timeline_events (
    id integer NOT NULL,
    patron_id integer NOT NULL,
    event_type character varying(50) NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb,
    related_incident_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by uuid
);


--
-- Name: patron_timeline_events_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.patron_timeline_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patron_timeline_events_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.patron_timeline_events_id_seq OWNED BY incidents.patron_timeline_events.id;


--
-- Name: patrons_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.patrons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patrons_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.patrons_id_seq OWNED BY incidents.patrons.id;


--
-- Name: quick_access_locations; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.quick_access_locations (
    id integer NOT NULL,
    sub_location_id integer,
    custom_name character varying(255),
    display_order integer DEFAULT 0,
    usage_count integer DEFAULT 0,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    org_unit uuid CONSTRAINT quick_access_locations_org_unit_uuid_not_null NOT NULL,
    user_id uuid CONSTRAINT quick_access_locations_user_id_uuid_not_null NOT NULL
);


--
-- Name: quick_access_locations_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.quick_access_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quick_access_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.quick_access_locations_id_seq OWNED BY incidents.quick_access_locations.id;


--
-- Name: resolution_checklists; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.resolution_checklists (
    id integer NOT NULL,
    incident_id integer NOT NULL,
    checklist_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    completed_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: resolution_checklists_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.resolution_checklists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: resolution_checklists_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.resolution_checklists_id_seq OWNED BY incidents.resolution_checklists.id;


--
-- Name: review_chain; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.review_chain (
    id integer NOT NULL,
    review_level integer NOT NULL,
    reviewer_group integer NOT NULL,
    is_final boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    require_peer_review boolean DEFAULT false NOT NULL,
    org_unit uuid CONSTRAINT review_chain_org_unit_uuid_not_null NOT NULL,
    CONSTRAINT review_chain_review_level_check CHECK ((review_level > 0))
);


--
-- Name: review_chain_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.review_chain_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_chain_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.review_chain_id_seq OWNED BY incidents.review_chain.id;


--
-- Name: review_group; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.review_group (
    id integer NOT NULL,
    name text,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_unit uuid CONSTRAINT review_group_org_unit_uuid_not_null NOT NULL
);


--
-- Name: review_group_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.review_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_group_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.review_group_id_seq OWNED BY incidents.review_group.id;


--
-- Name: review_group_member; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.review_group_member (
    id integer NOT NULL,
    review_group integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    usr uuid CONSTRAINT review_group_member_usr_uuid_not_null NOT NULL
);


--
-- Name: review_group_member_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.review_group_member_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_group_member_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.review_group_member_id_seq OWNED BY incidents.review_group_member.id;


--
-- Name: sub_locations; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.sub_locations (
    id integer NOT NULL,
    label character varying(255) NOT NULL,
    description text,
    code character varying(50),
    deleted_at timestamp with time zone,
    org_unit uuid CONSTRAINT sub_locations_org_unit_uuid_not_null NOT NULL
);


--
-- Name: sub_locations_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.sub_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sub_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.sub_locations_id_seq OWNED BY incidents.sub_locations.id;


--
-- Name: templates; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.templates (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category character varying(100) NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    version integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    requires_patron boolean DEFAULT true NOT NULL,
    show_called_emergency boolean DEFAULT true NOT NULL,
    created_by uuid
);


--
-- Name: templates_id_seq; Type: SEQUENCE; Schema: incidents; Owner: -
--

CREATE SEQUENCE incidents.templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: templates_id_seq; Type: SEQUENCE OWNED BY; Schema: incidents; Owner: -
--

ALTER SEQUENCE incidents.templates_id_seq OWNED BY incidents.templates.id;


--
-- Name: activity_log id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.activity_log ALTER COLUMN id SET DEFAULT nextval('incidents.activity_log_id_seq'::regclass);


--
-- Name: attachments id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.attachments ALTER COLUMN id SET DEFAULT nextval('incidents.attachments_id_seq'::regclass);


--
-- Name: ban_letter_template id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.ban_letter_template ALTER COLUMN id SET DEFAULT nextval('incidents.ban_letter_template_id_seq'::regclass);


--
-- Name: external_link id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link ALTER COLUMN id SET DEFAULT nextval('incidents.external_link_id_seq'::regclass);


--
-- Name: external_link_type id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link_type ALTER COLUMN id SET DEFAULT nextval('incidents.external_link_type_id_seq'::regclass);


--
-- Name: generated_ban_letter id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.generated_ban_letter ALTER COLUMN id SET DEFAULT nextval('incidents.generated_ban_letter_id_seq'::regclass);


--
-- Name: incident_links id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_links ALTER COLUMN id SET DEFAULT nextval('incidents.incident_links_id_seq'::regclass);


--
-- Name: incident_review id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_review ALTER COLUMN id SET DEFAULT nextval('incidents.incident_review_id_seq'::regclass);


--
-- Name: incident_template_map id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_template_map ALTER COLUMN id SET DEFAULT nextval('incidents.incident_template_map_id_seq'::regclass);


--
-- Name: incidents id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incidents ALTER COLUMN id SET DEFAULT nextval('incidents.incidents_id_seq'::regclass);


--
-- Name: involved_parties id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.involved_parties ALTER COLUMN id SET DEFAULT nextval('incidents.involved_parties_id_seq'::regclass);


--
-- Name: merge_history id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.merge_history ALTER COLUMN id SET DEFAULT nextval('incidents.merge_history_id_seq'::regclass);


--
-- Name: migration_attachment id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.migration_attachment ALTER COLUMN id SET DEFAULT nextval('incidents.migration_attachment_id_seq'::regclass);


--
-- Name: notification_email_routing id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.notification_email_routing ALTER COLUMN id SET DEFAULT nextval('incidents.notification_email_routing_id_seq'::regclass);


--
-- Name: patron_age_range id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_age_range ALTER COLUMN id SET DEFAULT nextval('incidents.patron_age_range_id_seq'::regclass);


--
-- Name: patron_ban id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_ban ALTER COLUMN id SET DEFAULT nextval('incidents.patron_ban_id_seq'::regclass);


--
-- Name: patron_notes id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_notes ALTER COLUMN id SET DEFAULT nextval('incidents.patron_notes_id_seq'::regclass);


--
-- Name: patron_photo id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_photo ALTER COLUMN id SET DEFAULT nextval('incidents.patron_photo_id_seq'::regclass);


--
-- Name: patron_timeline_events id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_timeline_events ALTER COLUMN id SET DEFAULT nextval('incidents.patron_timeline_events_id_seq'::regclass);


--
-- Name: patrons id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patrons ALTER COLUMN id SET DEFAULT nextval('incidents.patrons_id_seq'::regclass);


--
-- Name: quick_access_locations id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.quick_access_locations ALTER COLUMN id SET DEFAULT nextval('incidents.quick_access_locations_id_seq'::regclass);


--
-- Name: resolution_checklists id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.resolution_checklists ALTER COLUMN id SET DEFAULT nextval('incidents.resolution_checklists_id_seq'::regclass);


--
-- Name: review_chain id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_chain ALTER COLUMN id SET DEFAULT nextval('incidents.review_chain_id_seq'::regclass);


--
-- Name: review_group id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_group ALTER COLUMN id SET DEFAULT nextval('incidents.review_group_id_seq'::regclass);


--
-- Name: review_group_member id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_group_member ALTER COLUMN id SET DEFAULT nextval('incidents.review_group_member_id_seq'::regclass);


--
-- Name: sub_locations id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.sub_locations ALTER COLUMN id SET DEFAULT nextval('incidents.sub_locations_id_seq'::regclass);


--
-- Name: templates id; Type: DEFAULT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.templates ALTER COLUMN id SET DEFAULT nextval('incidents.templates_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: ban_letter_template ban_letter_template_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.ban_letter_template
    ADD CONSTRAINT ban_letter_template_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (code);


--
-- Name: incident_template_map chk_template_once_per_incident; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_template_map
    ADD CONSTRAINT chk_template_once_per_incident UNIQUE (incident, template);


--
-- Name: external_link external_link_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link
    ADD CONSTRAINT external_link_pkey PRIMARY KEY (id);


--
-- Name: external_link_type external_link_type_label_key; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link_type
    ADD CONSTRAINT external_link_type_label_key UNIQUE (label);


--
-- Name: external_link_type external_link_type_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link_type
    ADD CONSTRAINT external_link_type_pkey PRIMARY KEY (id);


--
-- Name: generated_ban_letter generated_ban_letter_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.generated_ban_letter
    ADD CONSTRAINT generated_ban_letter_pkey PRIMARY KEY (id);


--
-- Name: incident_links incident_links_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_links
    ADD CONSTRAINT incident_links_pkey PRIMARY KEY (id);


--
-- Name: incident_review incident_review_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_review
    ADD CONSTRAINT incident_review_pkey PRIMARY KEY (id);


--
-- Name: incident_template_map incident_template_map_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_template_map
    ADD CONSTRAINT incident_template_map_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: involved_parties involved_parties_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.involved_parties
    ADD CONSTRAINT involved_parties_pkey PRIMARY KEY (id);


--
-- Name: merge_history merge_history_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.merge_history
    ADD CONSTRAINT merge_history_pkey PRIMARY KEY (id);


--
-- Name: migration_attachment migration_attachment_external_id_key; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.migration_attachment
    ADD CONSTRAINT migration_attachment_external_id_key UNIQUE (external_id);


--
-- Name: migration_attachment migration_attachment_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.migration_attachment
    ADD CONSTRAINT migration_attachment_pkey PRIMARY KEY (id);


--
-- Name: notification_email_routing notification_email_routing_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.notification_email_routing
    ADD CONSTRAINT notification_email_routing_pkey PRIMARY KEY (id);


--
-- Name: patron_age_range patron_age_range_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_age_range
    ADD CONSTRAINT patron_age_range_pkey PRIMARY KEY (id);


--
-- Name: patron_ban patron_ban_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_ban
    ADD CONSTRAINT patron_ban_pkey PRIMARY KEY (id);


--
-- Name: patron_notes patron_notes_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_notes
    ADD CONSTRAINT patron_notes_pkey PRIMARY KEY (id);


--
-- Name: patron_photo patron_photo_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_photo
    ADD CONSTRAINT patron_photo_pkey PRIMARY KEY (id);


--
-- Name: patron_timeline_events patron_timeline_events_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_timeline_events
    ADD CONSTRAINT patron_timeline_events_pkey PRIMARY KEY (id);


--
-- Name: patrons patrons_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patrons
    ADD CONSTRAINT patrons_pkey PRIMARY KEY (id);


--
-- Name: quick_access_locations quick_access_locations_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.quick_access_locations
    ADD CONSTRAINT quick_access_locations_pkey PRIMARY KEY (id);


--
-- Name: resolution_checklists resolution_checklists_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.resolution_checklists
    ADD CONSTRAINT resolution_checklists_pkey PRIMARY KEY (id);


--
-- Name: review_chain review_chain_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_chain
    ADD CONSTRAINT review_chain_pkey PRIMARY KEY (id);


--
-- Name: review_group_member review_group_member_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_group_member
    ADD CONSTRAINT review_group_member_pkey PRIMARY KEY (id);


--
-- Name: review_group review_group_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_group
    ADD CONSTRAINT review_group_pkey PRIMARY KEY (id);


--
-- Name: sub_locations sub_locations_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.sub_locations
    ADD CONSTRAINT sub_locations_pkey PRIMARY KEY (id);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: activity_log_actor_idx; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX activity_log_actor_idx ON incidents.activity_log USING btree (actor_id, created_at DESC);


--
-- Name: activity_log_ban_idx; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX activity_log_ban_idx ON incidents.activity_log USING btree (ban_id, created_at DESC) WHERE (ban_id IS NOT NULL);


--
-- Name: activity_log_incident_idx; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX activity_log_incident_idx ON incidents.activity_log USING btree (incident_id, created_at DESC) WHERE (incident_id IS NOT NULL);


--
-- Name: idx_attachments_activity_log; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_attachments_activity_log ON incidents.attachments USING btree (activity_log_id) WHERE (activity_log_id IS NOT NULL);


--
-- Name: idx_ban_letter_activity_log; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_ban_letter_activity_log ON incidents.generated_ban_letter USING btree (activity_log_id);


--
-- Name: idx_categories_active; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_categories_active ON incidents.categories USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_external_link_activity_log; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_external_link_activity_log ON incidents.external_link USING btree (activity_log_id) WHERE (activity_log_id IS NOT NULL);


--
-- Name: idx_external_link_added_at; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_external_link_added_at ON incidents.external_link USING btree (added_at);


--
-- Name: idx_external_link_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_external_link_incident ON incidents.external_link USING btree (incident);


--
-- Name: idx_external_link_link_type; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_external_link_link_type ON incidents.external_link USING btree (link_type);


--
-- Name: idx_external_link_unique_activity_log_url; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX idx_external_link_unique_activity_log_url ON incidents.external_link USING btree (activity_log_id, url) WHERE ((activity_log_id IS NOT NULL) AND (incident IS NULL));


--
-- Name: idx_external_link_unique_incident_url; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX idx_external_link_unique_incident_url ON incidents.external_link USING btree (incident, url) WHERE (incident IS NOT NULL);


--
-- Name: idx_incident_links_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incident_links_incident ON incidents.incident_links USING btree (incident_id);


--
-- Name: idx_incident_links_linked; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incident_links_linked ON incidents.incident_links USING btree (linked_incident_id);


--
-- Name: idx_incident_links_unique; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX idx_incident_links_unique ON incidents.incident_links USING btree (LEAST(incident_id, linked_incident_id), GREATEST(incident_id, linked_incident_id));


--
-- Name: idx_incident_template_map_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incident_template_map_incident ON incidents.incident_template_map USING btree (incident);


--
-- Name: idx_incidents_ai_pending; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_ai_pending ON incidents.incidents USING btree (id) WHERE ((ai_analysis IS NULL) AND (emergency_capture = true) AND (deleted_at IS NULL));


--
-- Name: idx_incidents_audit; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_audit ON incidents.incidents USING btree (created_by, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_incidents_created_at; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_created_at ON incidents.incidents USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_incidents_date_range; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_date_range ON incidents.incidents USING btree (created_at, org_unit) WHERE (deleted_at IS NULL);


--
-- Name: idx_incidents_emergency; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_emergency ON incidents.incidents USING btree (emergency_capture) WHERE ((emergency_capture = true) AND (deleted_at IS NULL));


--
-- Name: idx_incidents_location; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_location ON incidents.incidents USING btree (org_unit) WHERE (deleted_at IS NULL);


--
-- Name: idx_incidents_metadata; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_metadata ON incidents.incidents USING gin (metadata);


--
-- Name: idx_incidents_occurred_at; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_occurred_at ON incidents.incidents USING btree (occurred_at DESC);


--
-- Name: idx_incidents_search; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_search ON incidents.incidents USING gin (to_tsvector('english'::regconfig, (((title)::text || ' '::text) || COALESCE(description, ''::text)))) WHERE (deleted_at IS NULL);


--
-- Name: idx_incidents_sub_location; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_sub_location ON incidents.incidents USING btree (sub_location) WHERE (sub_location IS NOT NULL);


--
-- Name: idx_involved_parties_compound; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_involved_parties_compound ON incidents.involved_parties USING btree (incident_id, party_type, COALESCE(patron_id, 0), staff_id);


--
-- Name: idx_involved_parties_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_involved_parties_incident ON incidents.involved_parties USING btree (incident_id);


--
-- Name: idx_involved_parties_patron; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_involved_parties_patron ON incidents.involved_parties USING btree (patron_id) WHERE (patron_id IS NOT NULL);


--
-- Name: idx_involved_parties_staff; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_involved_parties_staff ON incidents.involved_parties USING btree (staff_id) WHERE (staff_id IS NOT NULL);


--
-- Name: idx_merge_history_merged; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_merge_history_merged ON incidents.merge_history USING btree (merged_patron_id);


--
-- Name: idx_merge_history_primary; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_merge_history_primary ON incidents.merge_history USING btree (primary_patron_id);


--
-- Name: idx_notes_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_notes_incident ON incidents.patron_notes USING btree (incident_id) WHERE ((incident_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_notes_patron; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_notes_patron ON incidents.patron_notes USING btree (patron_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_notes_type; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_notes_type ON incidents.patron_notes USING btree (patron_id, note_type) WHERE (deleted_at IS NULL);


--
-- Name: idx_notification_email_routing_lookup; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_notification_email_routing_lookup ON incidents.notification_email_routing USING btree (template_code, incident_org_unit) WHERE (is_active = true);


--
-- Name: idx_patron_ban_patron_is_trespass; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patron_ban_patron_is_trespass ON incidents.patron_ban USING btree (patron, is_trespass);


--
-- Name: idx_patron_changes; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patron_changes ON incidents.patrons USING btree (updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_patron_incidents_pattern; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patron_incidents_pattern ON incidents.involved_parties USING btree (patron_id, incident_id) WHERE (patron_id IS NOT NULL);


--
-- Name: idx_patron_timeline_created; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patron_timeline_created ON incidents.patron_timeline_events USING btree (patron_id, created_at DESC);


--
-- Name: idx_patron_timeline_patron; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patron_timeline_patron ON incidents.patron_timeline_events USING btree (patron_id);


--
-- Name: idx_patrons_contact; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_contact ON incidents.patrons USING btree (COALESCE(email, ''::character varying), COALESCE(phone, ''::character varying), COALESCE(library_card, ''::character varying)) WHERE (deleted_at IS NULL);


--
-- Name: idx_patrons_email; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_email ON incidents.patrons USING btree (email) WHERE ((deleted_at IS NULL) AND (email IS NOT NULL));


--
-- Name: idx_patrons_full_name; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_full_name ON incidents.patrons USING gin (to_tsvector('english'::regconfig, (((((((first_name)::text || ' '::text) || (COALESCE(middle_name, ''::character varying))::text) || ' '::text) || (last_name)::text) || ' '::text) || (COALESCE(preferred_name, ''::character varying))::text))) WHERE (deleted_at IS NULL);


--
-- Name: idx_patrons_library_card; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_library_card ON incidents.patrons USING btree (library_card) WHERE (deleted_at IS NULL);


--
-- Name: idx_patrons_metadata; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_metadata ON incidents.patrons USING gin (metadata);


--
-- Name: idx_patrons_name; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_name ON incidents.patrons USING btree (last_name, first_name) WHERE (deleted_at IS NULL);


--
-- Name: idx_patrons_phone; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_phone ON incidents.patrons USING btree (phone) WHERE ((deleted_at IS NULL) AND (phone IS NOT NULL));


--
-- Name: idx_patrons_risk_level; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_patrons_risk_level ON incidents.patrons USING btree (risk_level) WHERE (deleted_at IS NULL);


--
-- Name: idx_resolution_checklists_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_resolution_checklists_incident ON incidents.resolution_checklists USING btree (incident_id);


--
-- Name: idx_review_chain_group; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_review_chain_group ON incidents.review_chain USING btree (reviewer_group);


--
-- Name: idx_review_chain_org_unit; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_review_chain_org_unit ON incidents.review_chain USING btree (org_unit);


--
-- Name: idx_review_group_member_group; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_review_group_member_group ON incidents.review_group_member USING btree (review_group);


--
-- Name: idx_review_group_org_unit; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_review_group_org_unit ON incidents.review_group USING btree (org_unit);


--
-- Name: idx_sub_locations_location; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_sub_locations_location ON incidents.sub_locations USING btree (org_unit) WHERE (deleted_at IS NULL);


--
-- Name: idx_templates_active; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_templates_active ON incidents.templates USING btree (is_active) WHERE (deleted_at IS NULL);


--
-- Name: idx_templates_category; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_templates_category ON incidents.templates USING btree (category) WHERE (deleted_at IS NULL);


--
-- Name: patron_photo_is_primary_once_per; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX patron_photo_is_primary_once_per ON incidents.patron_photo USING btree (patron) WHERE is_primary;


--
-- Name: patrons_library_card_key; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX patrons_library_card_key ON incidents.patrons USING btree (library_card) WHERE (deleted_at IS NULL);


--
-- Name: review_chain_org_unit_review_level_key; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX review_chain_org_unit_review_level_key ON incidents.review_chain USING btree (org_unit, review_level);


--
-- Name: uq_notification_email_routing; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX uq_notification_email_routing ON incidents.notification_email_routing USING btree (template_code, email_group, incident_org_unit);


--
-- Name: patrons patrons_set_display_name_trigger; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER patrons_set_display_name_trigger BEFORE INSERT OR UPDATE OF first_name, last_name ON incidents.patrons FOR EACH ROW EXECUTE FUNCTION incidents.patrons_set_display_name();


--
-- Name: review_chain trg_cleanup_orphaned_review_group; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_cleanup_orphaned_review_group AFTER DELETE ON incidents.review_chain FOR EACH ROW EXECUTE FUNCTION incidents.cleanup_orphaned_review_group();


--
-- Name: incidents update_incidents_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER update_incidents_updated_at BEFORE UPDATE ON incidents.incidents FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();


--
-- Name: patron_notes update_notes_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER update_notes_updated_at BEFORE UPDATE ON incidents.patron_notes FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();


--
-- Name: patrons update_patrons_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER update_patrons_updated_at BEFORE UPDATE ON incidents.patrons FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();


--
-- Name: resolution_checklists update_resolution_checklists_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER update_resolution_checklists_updated_at BEFORE UPDATE ON incidents.resolution_checklists FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();


--
-- Name: templates update_templates_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON incidents.templates FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();


--
-- Name: activity_log activity_log_ban_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.activity_log
    ADD CONSTRAINT activity_log_ban_id_fkey FOREIGN KEY (ban_id) REFERENCES incidents.patron_ban(id) ON DELETE SET NULL;


--
-- Name: activity_log activity_log_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.activity_log
    ADD CONSTRAINT activity_log_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_activity_log_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.attachments
    ADD CONSTRAINT attachments_activity_log_id_fkey FOREIGN KEY (activity_log_id) REFERENCES incidents.activity_log(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.attachments
    ADD CONSTRAINT attachments_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id);


--
-- Name: external_link external_link_activity_log_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link
    ADD CONSTRAINT external_link_activity_log_id_fkey FOREIGN KEY (activity_log_id) REFERENCES incidents.activity_log(id) ON DELETE CASCADE;


--
-- Name: external_link external_link_incident_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link
    ADD CONSTRAINT external_link_incident_fkey FOREIGN KEY (incident) REFERENCES incidents.incidents(id) ON DELETE CASCADE;


--
-- Name: external_link external_link_link_type_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.external_link
    ADD CONSTRAINT external_link_link_type_fkey FOREIGN KEY (link_type) REFERENCES incidents.external_link_type(id);


--
-- Name: templates fk_template_category; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.templates
    ADD CONSTRAINT fk_template_category FOREIGN KEY (category) REFERENCES incidents.categories(code) ON UPDATE CASCADE;


--
-- Name: generated_ban_letter generated_ban_letter_activity_log_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.generated_ban_letter
    ADD CONSTRAINT generated_ban_letter_activity_log_id_fkey FOREIGN KEY (activity_log_id) REFERENCES incidents.activity_log(id) ON DELETE SET NULL;


--
-- Name: generated_ban_letter generated_ban_letter_ban_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.generated_ban_letter
    ADD CONSTRAINT generated_ban_letter_ban_fkey FOREIGN KEY (ban) REFERENCES incidents.patron_ban(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: generated_ban_letter generated_ban_letter_incident_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.generated_ban_letter
    ADD CONSTRAINT generated_ban_letter_incident_fkey FOREIGN KEY (incident) REFERENCES incidents.incidents(id) ON DELETE SET NULL;


--
-- Name: generated_ban_letter generated_ban_letter_template_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.generated_ban_letter
    ADD CONSTRAINT generated_ban_letter_template_fkey FOREIGN KEY (template) REFERENCES incidents.ban_letter_template(id) ON DELETE SET NULL;


--
-- Name: incident_links incident_links_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_links
    ADD CONSTRAINT incident_links_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id);


--
-- Name: incident_review incident_review_incident_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_review
    ADD CONSTRAINT incident_review_incident_fkey FOREIGN KEY (incident) REFERENCES incidents.incidents(id);


--
-- Name: incident_template_map incident_template_map_incident_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_template_map
    ADD CONSTRAINT incident_template_map_incident_fkey FOREIGN KEY (incident) REFERENCES incidents.incidents(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: incident_template_map incident_template_map_template_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_template_map
    ADD CONSTRAINT incident_template_map_template_fkey FOREIGN KEY (template) REFERENCES incidents.templates(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: incidents incidents_sub_location_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incidents
    ADD CONSTRAINT incidents_sub_location_fkey FOREIGN KEY (sub_location) REFERENCES incidents.sub_locations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: involved_parties involved_parties_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.involved_parties
    ADD CONSTRAINT involved_parties_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id);


--
-- Name: merge_history merge_history_primary_patron_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.merge_history
    ADD CONSTRAINT merge_history_primary_patron_id_fkey FOREIGN KEY (primary_patron_id) REFERENCES incidents.patrons(id);


--
-- Name: migration_attachment migration_attachment_incident_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.migration_attachment
    ADD CONSTRAINT migration_attachment_incident_fkey FOREIGN KEY (incident) REFERENCES incidents.incidents(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: migration_attachment migration_attachment_patron_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.migration_attachment
    ADD CONSTRAINT migration_attachment_patron_fkey FOREIGN KEY (patron) REFERENCES incidents.patrons(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: patron_notes notes_patron_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_notes
    ADD CONSTRAINT notes_patron_id_fkey FOREIGN KEY (patron_id) REFERENCES incidents.patrons(id);


--
-- Name: patron_ban patron_ban_incident_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_ban
    ADD CONSTRAINT patron_ban_incident_fkey FOREIGN KEY (incident) REFERENCES incidents.incidents(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: patron_ban patron_ban_patron_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_ban
    ADD CONSTRAINT patron_ban_patron_fkey FOREIGN KEY (patron) REFERENCES incidents.patrons(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: patron_photo patron_photo_patron_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_photo
    ADD CONSTRAINT patron_photo_patron_fkey FOREIGN KEY (patron) REFERENCES incidents.patrons(id);


--
-- Name: patrons patrons_age_range_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patrons
    ADD CONSTRAINT patrons_age_range_fkey FOREIGN KEY (age_range) REFERENCES incidents.patron_age_range(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: quick_access_locations quick_access_locations_sub_location_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.quick_access_locations
    ADD CONSTRAINT quick_access_locations_sub_location_id_fkey FOREIGN KEY (sub_location_id) REFERENCES incidents.sub_locations(id);


--
-- Name: resolution_checklists resolution_checklists_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.resolution_checklists
    ADD CONSTRAINT resolution_checklists_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id);


--
-- Name: review_chain review_chain_reviewer_group_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_chain
    ADD CONSTRAINT review_chain_reviewer_group_fkey FOREIGN KEY (reviewer_group) REFERENCES incidents.review_group(id);


--
-- Name: review_group_member review_group_member_review_group_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.review_group_member
    ADD CONSTRAINT review_group_member_review_group_fkey FOREIGN KEY (review_group) REFERENCES incidents.review_group(id) ON DELETE CASCADE;


--
-- Name: patron_timeline_events timeline_events_patron_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.patron_timeline_events
    ADD CONSTRAINT timeline_events_patron_id_fkey FOREIGN KEY (patron_id) REFERENCES incidents.patrons(id);


--
-- PostgreSQL database dump complete
--

\unrestrict KcfzNKDCQUhiR1JuXSjNy1bBom9zDFYycPWTBZ2Y7MexBuj9xw6DdYktptXeibc


COMMIT;
