import type { Role } from "@ignara/sharedtypes";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { OrganizationEntity } from "./organization.entity";

@Entity("users")
export class UserEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "org_id" })
  orgId!: string;

  @ManyToOne(() => OrganizationEntity, (org) => org.users)
  @JoinColumn({ name: "org_id" })
  organization!: OrganizationEntity;

  @Column({ type: "varchar", length: 255, unique: true })
  email!: string;

  @Column({ type: "varchar", length: 16 })
  role!: Role;

  @Column({ type: "text" })
  password!: string;

  @Column({ type: "varchar", length: 64, nullable: true, name: "tag_device_id" })
  tagDeviceId?: string | null;
}
