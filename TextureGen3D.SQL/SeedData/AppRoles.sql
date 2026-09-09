-- Seed data for AppRoles
INSERT INTO public."AppRoles" ("Id", "Name") VALUES (1, 'admin') ON CONFLICT ("Id") DO NOTHING;
INSERT INTO public."AppRoles" ("Id", "Name") VALUES (2, 'user') ON CONFLICT ("Id") DO NOTHING;
--INSERT INTO public."AppRoles" ("Id", "Name") VALUES (3, 'owner') ON CONFLICT ("Id") DO NOTHING;
--INSERT INTO public."AppRoles" ("Id", "Name") VALUES (4, 'manager') ON CONFLICT ("Id") DO NOTHING;
