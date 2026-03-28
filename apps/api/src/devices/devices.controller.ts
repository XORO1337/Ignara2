import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { UsbDeviceConfigRequest } from "@ignara/sharedtypes";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { DevicesService } from "./devices.service";

type SessionUser = {
  orgId: string;
  role?: string;
  email?: string;
};

@Controller("devices")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "manager")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  private isDevUser(email?: string) {
    const configured = (process.env.DEV_USER_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    return !!email && configured.includes(email.toLowerCase());
  }

  private assertAdminOrDev(request: Request & { user?: SessionUser }) {
    const role = request.user?.role;
    const email = request.user?.email;
    if (role === "admin" || this.isDevUser(email)) {
      return;
    }

    throw new ForbiddenException("Only admin and dev users can access USB configuration");
  }

  private getOrgId(request: Request & { user?: SessionUser }) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }
    return orgId;
  }

  @Get("tags")
  listTags(@Req() request: Request & { user?: SessionUser }) {
    return this.devicesService.listTagsByOrg(this.getOrgId(request));
  }

  @Get("scanners")
  listScanners(@Req() request: Request & { user?: SessionUser }) {
    return this.devicesService.listScannersByOrg(this.getOrgId(request));
  }

  @Post("tags")
  registerTag(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: { deviceId: string; roomId?: string },
  ) {
    const deviceId = body?.deviceId?.trim();
    const roomId = body?.roomId?.trim();

    if (!deviceId) {
      throw new BadRequestException("deviceId is required");
    }

    return this.devicesService.registerTag({
      orgId: this.getOrgId(request),
      deviceId,
      roomId: roomId || null,
    });
  }

  @Put("tags/:id/wifi")
  assignWifi(
    @Req() request: Request & { user?: SessionUser },
    @Param("id") id: string,
    @Body() body: { ssid: string; password: string },
  ) {
    const ssid = body?.ssid?.trim();
    const password = body?.password?.trim();

    if (!ssid || !password) {
      throw new BadRequestException("Both ssid and password are required");
    }

    return this.devicesService.assignWifiCredentials({
      orgId: this.getOrgId(request),
      deviceId: id,
      ssid,
      password,
    });
  }

  @Get("usb/targets")
  @Roles()
  async listUsbTargets(@Req() request: Request & { user?: SessionUser }) {
    this.assertAdminOrDev(request);
    const orgId = this.getOrgId(request);

    const [tags, scanners] = await Promise.all([
      this.devicesService.listTagsByOrg(orgId),
      this.devicesService.listScannersByOrg(orgId),
    ]);

    return { tags, scanners };
  }

  @Post("usb/commands/generate")
  @Roles()
  generateUsbCommands(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: UsbDeviceConfigRequest,
  ) {
    this.assertAdminOrDev(request);

    if (!body?.deviceId?.trim()) {
      throw new BadRequestException("deviceId is required");
    }

    if (!body?.wifiSsid?.trim() || !body?.wifiPassword?.trim()) {
      throw new BadRequestException("wifiSsid and wifiPassword are required");
    }

    if (body.enablePasswordProtection && !body?.secureConfigPassword?.trim()) {
      throw new BadRequestException("secureConfigPassword is required when password protection is enabled");
    }

    return this.devicesService.generateUsbConfigCommands({
      orgId: this.getOrgId(request),
      request: {
        ...body,
        deviceId: body.deviceId.trim(),
        wifiSsid: body.wifiSsid.trim(),
        wifiPassword: body.wifiPassword.trim(),
        secureConfigPassword: body.secureConfigPassword?.trim(),
      },
    });
  }
}
