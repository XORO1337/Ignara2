import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrganizationEntity } from "../entities/organization.entity";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([OrganizationEntity]),
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET ?? "replace-me",
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? "15m" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
