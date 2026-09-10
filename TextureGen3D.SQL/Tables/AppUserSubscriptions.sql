CREATE TABLE IF NOT EXISTS public."AppUserSubscriptions" (
    "Id" SERIAL PRIMARY KEY,
    "AppUserId" UUID NOT NULL,
    "SubscriptionId" INTEGER NOT NULL,
    "StartDate" TIMESTAMP NOT NULL,
    "EndDate" TIMESTAMP,
    "Cancelled" BOOLEAN NOT NULL DEFAULT FALSE,
    "DateCreated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_AppUserSubscriptions_AppUsers" FOREIGN KEY ("AppUserId") REFERENCES public."AppUsers"("Id") ON DELETE CASCADE
);
