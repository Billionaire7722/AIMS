import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LocalStorageService } from "./storage.service.js";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
