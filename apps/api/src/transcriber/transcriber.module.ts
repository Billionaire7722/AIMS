import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TranscriberClientService } from "./transcriber-client.service.js";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [TranscriberClientService],
  exports: [TranscriberClientService],
})
export class TranscriberModule {}
