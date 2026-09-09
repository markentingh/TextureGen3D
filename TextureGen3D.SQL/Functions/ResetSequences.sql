CREATE OR REPLACE FUNCTION public."ResetAllSequences"()
RETURNS void AS $$
DECLARE
    seq RECORD;
    max_value INTEGER;
BEGIN
    FOR seq IN
        SELECT
            c.relname AS sequence_name,
            t.relname AS table_relname,
            a.attname AS column_attname
        FROM pg_class c
        JOIN pg_depend d ON c.oid = d.objid
        JOIN pg_class t ON d.refobjid = t.oid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE c.relkind = 'S' AND d.deptype = 'a'
          AND t.relname IS NOT NULL AND t.relname <> ''
          AND a.attname IS NOT NULL AND a.attname <> ''
    LOOP
        EXECUTE format('SELECT COALESCE(MAX(%I) + 1, 1) FROM public.%I', seq.column_attname, seq.table_relname)
            INTO max_value;
        EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH %s', seq.sequence_name, max_value);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
