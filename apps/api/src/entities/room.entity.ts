import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("rooms")
export class RoomEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "org_id" })
  orgId!: string;

  @Column("uuid", { name: "map_id" })
  mapId!: string;

  @Column({ type: "varchar", length: 255 })
  label!: string;

  @Column({ type: "varchar", length: 64, nullable: true, name: "scanner_device_id" })
  scannerDeviceId?: string | null;

  @Column({ type: "float" })
  x!: number;

  @Column({ type: "float" })
  y!: number;

  @Column({ type: "float" })
  w!: number;

  @Column({ type: "float" })
  h!: number;
}
