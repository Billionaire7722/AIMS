import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  ProjectEntity,
  ProjectSchema,
  ScoreEntity,
  ScoreSchema,
  TranscriptionJobEntity,
  TranscriptionJobSchema,
  UploadEntity,
  UploadSchema,
  UserEntity,
  UserSchema,
} from "./mongo.schemas.js";

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEntity.name, schema: UserSchema },
      { name: ProjectEntity.name, schema: ProjectSchema },
      { name: UploadEntity.name, schema: UploadSchema },
      { name: TranscriptionJobEntity.name, schema: TranscriptionJobSchema },
      { name: ScoreEntity.name, schema: ScoreSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class MongoModelsModule {}
