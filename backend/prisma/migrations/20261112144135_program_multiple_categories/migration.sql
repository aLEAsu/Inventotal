-- Programas por categoría que abarcan varias categorías (la principal sigue en maintenance_programs.categoryId)

-- CreateTable
CREATE TABLE "maintenance_program_categories" (
    "programId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "maintenance_program_categories_pkey" PRIMARY KEY ("programId","categoryId")
);

-- CreateIndex
CREATE INDEX "maintenance_program_categories_categoryId_idx" ON "maintenance_program_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "maintenance_program_categories" ADD CONSTRAINT "maintenance_program_categories_programId_fkey" FOREIGN KEY ("programId") REFERENCES "maintenance_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_program_categories" ADD CONSTRAINT "maintenance_program_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo la API (rol dueño) accede: igual que el resto de tablas (ver security_hardening)
ALTER TABLE "maintenance_program_categories" ENABLE ROW LEVEL SECURITY;
