import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { UserRestrictions, UserStatus } from "@ignara/sharedtypes";
import { UserEntity } from "../entities/user.entity";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  findByEmail(email: string) {
    return this.usersRepository.findOne({ where: { email } });
  }

  findById(id: string) {
    return this.usersRepository.findOne({ where: { id } });
  }

  async updatePassword(id: string, password: string) {
    await this.usersRepository.update({ id }, { password });
  }

  async create(data: Partial<UserEntity> & { id: string; email: string; password: string; role: string; orgId: string }) {
    const user = this.usersRepository.create({
      ...data,
      status: data.status ?? "active",
      restrictions: data.restrictions ?? {},
    });
    return this.usersRepository.save(user);
  }

  async listByOrg(orgId: string) {
    return this.usersRepository
      .createQueryBuilder("user")
      .select([
        "user.id",
        "user.orgId",
        "user.email",
        "user.role",
        "user.gender",
        "user.tagDeviceId",
        "user.status",
        "user.restrictions",
      ])
      .where("user.orgId = :orgId", { orgId })
      .orderBy("user.email", "ASC")
      .getMany();
  }

  async updateUser(
    id: string,
    orgId: string,
    updates: {
      email?: string;
      password?: string;
      role?: string;
      gender?: string;
      tagDeviceId?: string | null;
      status?: UserStatus;
      restrictions?: UserRestrictions;
    },
  ) {
    const user = await this.usersRepository.findOne({ where: { id, orgId } });
    if (!user) {
      throw new NotFoundException("User not found in this organization");
    }

    if (updates.email !== undefined) {
      user.email = updates.email;
    }
    if (updates.password !== undefined) {
      user.password = updates.password;
    }
    if (updates.role !== undefined) {
      user.role = updates.role as UserEntity["role"];
    }
    if (updates.gender !== undefined) {
      user.gender = updates.gender as UserEntity["gender"];
    }
    if (updates.tagDeviceId !== undefined) {
      user.tagDeviceId = updates.tagDeviceId;
    }
    if (updates.status !== undefined) {
      user.status = updates.status;
    }
    if (updates.restrictions !== undefined) {
      user.restrictions = updates.restrictions;
    }

    await this.usersRepository.save(user);

    return {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      role: user.role,
      gender: user.gender,
      tagDeviceId: user.tagDeviceId,
      status: user.status,
      restrictions: user.restrictions,
    };
  }

  async deleteUser(id: string, orgId: string) {
    const user = await this.usersRepository.findOne({ where: { id, orgId } });
    if (!user) {
      throw new NotFoundException("User not found in this organization");
    }

    await this.usersRepository.remove(user);
    return { ok: true, deletedUserId: id };
  }
}
