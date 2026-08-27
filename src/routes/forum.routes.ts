import { Router } from "express";
import {
  createComment,
  createPost,
  favoritePost,
  getPostDetail,
  hideOwnComment,
  hideOwnPost,
  likePost,
  listCategories,
  listFavorites,
  listPosts,
} from "../controllers/forum.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/categories", requireAuth, listCategories);
router.get("/favorites", requireAuth, listFavorites);
router.get("/posts", requireAuth, listPosts);
router.post("/posts", requireAuth, createPost);
router.get("/posts/:postId", requireAuth, getPostDetail);
router.delete("/posts/:postId", requireAuth, hideOwnPost);
router.post("/posts/:postId/like", requireAuth, likePost);
router.delete("/posts/:postId/like", requireAuth, likePost);
router.post("/posts/:postId/favorite", requireAuth, favoritePost);
router.delete("/posts/:postId/favorite", requireAuth, favoritePost);
router.post("/posts/:postId/comments", requireAuth, createComment);
router.delete("/comments/:commentId", requireAuth, hideOwnComment);

export default router;
