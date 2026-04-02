import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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

  async listByOrg(orgId: string) {
    return this.usersRepository
      .createQueryBuilder("user")
      .select(["user.id", "user.orgId", "user.email", "user.role", "user.gender", "user.tagDeviceId"])
      .where("user.orgId = :orgId", { orgId })
      .orderBy("user.email", "ASC")
      .getMany();
  }
}
