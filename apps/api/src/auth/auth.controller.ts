import { BadRequestException, Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("Email and password are required");
    }

    const result = await this.authService.login(body.email, body.password);

    response.cookie("ignara_access", result.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 15 * 60 * 1000,
    });

    return { user: result.user };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie("ignara_access");
    return { ok: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() request: Request & { user?: unknown }) {
    return { user: request.user };
  }
}
