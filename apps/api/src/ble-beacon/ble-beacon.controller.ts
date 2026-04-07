import { Controller, Get, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { BleBeaconStatus, BleTagConnection } from "@ignara/sharedtypes";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { BleBeaconService } from "./ble-beacon.service";

type SessionUser = {
  orgId: string;
  email: string;
  role: "admin" | "manager" | "employee";
};

@Controller("ble-beacon")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "manager")
export class BleBeaconController {
  constructor(private readonly bleBeaconService: BleBeaconService) {}

  @Get("status")
  getStatus(): BleBeaconStatus | null {
    return this.bleBeaconService.getStatus();
  }

  @Get("tags")
  getConnectedTags(): BleTagConnection[] {
    return this.bleBeaconService.getConnectedTags();
  }
}
