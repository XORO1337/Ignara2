import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("maps")
export class MapEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "org_id" })
  orgId!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "jsonb", name: "json_config", default: {} })
  jsonConfig!: Record<string, unknown>;
}
